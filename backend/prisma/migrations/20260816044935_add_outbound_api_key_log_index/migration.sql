-- CreateIndex
CREATE INDEX `webhook_logs_api_key_received_at_idx` ON `webhook_logs`(`api_key_id`, `received_at` DESC);
