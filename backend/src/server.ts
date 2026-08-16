import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const app = buildApp();

try {
  await app.listen({ host: env.host, port: env.port });
  console.log(
    `[backend] listening on http://${env.host}:${env.port} (Meta Graph ${env.metaGraphApiVersion})`,
  );
} catch (error) {
  const code = error instanceof Error && "code" in error ? String(error.code) : undefined;
  if (code === "EADDRINUSE") {
    console.error(
      `[backend] cannot start: ${env.host}:${env.port} is already in use. ` +
        "Stop the existing process or change PORT in backend/.env.",
    );
  } else {
    console.error("[backend] startup error", error);
  }
  process.exit(1);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[backend] ${signal} received, shutting down`);

  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
