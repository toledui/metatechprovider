import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { claimNextWebhookLog, deliverWebhookLog, recoverStaleWebhookLogs } from "./webhooks/delivery.js";

let running = true;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[webhook-worker] ${signal} received, shutting down`);
  running = false;
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

const recovered = await recoverStaleWebhookLogs();
console.log(`[webhook-worker] started; recovered=${recovered}`);

while (running) {
  try {
    const logId = await claimNextWebhookLog();
    if (logId) await deliverWebhookLog(logId);
    else await wait(env.webhookWorkerPollMs);
  } catch (error) {
    console.error("[webhook-worker] processing error", error);
    await wait(Math.min(env.webhookWorkerPollMs * 5, 10_000));
  }
}

await prisma.$disconnect();
console.log("[webhook-worker] stopped");
