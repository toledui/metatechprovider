import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
import { metaConfig } from "../config/meta.js";
import { getMetaSettings } from "../settings/service.js";

export async function configRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config/public", async () => {
    const meta = await getMetaSettings();
    return {
      meta: {
        appId: meta?.config.appId ?? null,
        configId: meta?.config.configId ?? null,
        graphApiVersion: metaConfig.graphApiVersion,
        configured: Boolean(
          meta?.enabled &&
            meta.config.appId &&
            meta.config.appSecret &&
            meta.config.configId &&
            env.credentialsEncryptionKey,
        ),
      },
    };
  });
}
