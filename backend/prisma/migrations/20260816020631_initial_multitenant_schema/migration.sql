-- CreateTable
CREATE TABLE `tenants` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `status` ENUM('ONBOARDING', 'ACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ONBOARDING',
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'UTC',
    `settings` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `tenants_public_id_key`(`public_id`),
    UNIQUE INDEX `tenants_slug_key`(`slug`),
    INDEX `tenants_status_created_at_idx`(`status`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `status` ENUM('INVITED', 'ACTIVE', 'DISABLED') NOT NULL DEFAULT 'INVITED',
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_public_id_key`(`public_id`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_tenant_status_idx`(`tenant_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsapp_connections` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `waba_id` VARCHAR(64) NOT NULL,
    `phone_number_id` VARCHAR(64) NOT NULL,
    `display_phone_number` VARCHAR(32) NULL,
    `verified_name` VARCHAR(255) NULL,
    `access_token_encrypted` TEXT NOT NULL,
    `token_type` ENUM('SHORT_LIVED', 'LONG_LIVED', 'SYSTEM_USER') NOT NULL DEFAULT 'SHORT_LIVED',
    `token_expires_at` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'DISCONNECTED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `webhook_url` VARCHAR(2048) NULL,
    `webhook_secret_encrypted` TEXT NULL,
    `coexistence_enabled` BOOLEAN NOT NULL DEFAULT false,
    `meta_business_id` VARCHAR(64) NULL,
    `metadata` JSON NULL,
    `connected_at` DATETIME(3) NULL,
    `last_webhook_at` DATETIME(3) NULL,
    `last_error_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `wa_connections_public_id_key`(`public_id`),
    UNIQUE INDEX `wa_connections_phone_number_id_key`(`phone_number_id`),
    INDEX `wa_connections_tenant_status_idx`(`tenant_id`, `status`),
    INDEX `wa_connections_tenant_waba_idx`(`tenant_id`, `waba_id`),
    INDEX `wa_connections_tenant_created_at_idx`(`tenant_id`, `created_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `created_by_user_id` BIGINT UNSIGNED NULL,
    `name` VARCHAR(100) NOT NULL,
    `key_prefix` VARCHAR(16) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `last_four` CHAR(4) NOT NULL,
    `scopes` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `last_used_at` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `api_keys_public_id_key`(`public_id`),
    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    INDEX `api_keys_tenant_status_idx`(`tenant_id`, `status`),
    INDEX `api_keys_tenant_created_at_idx`(`tenant_id`, `created_at` DESC),
    INDEX `api_keys_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NULL,
    `connection_id` BIGINT UNSIGNED NULL,
    `api_key_id` BIGINT UNSIGNED NULL,
    `actor_user_id` BIGINT UNSIGNED NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `source` ENUM('META', 'API_GATEWAY', 'CRM', 'N8N', 'INTERNAL') NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `external_event_id` VARCHAR(191) NULL,
    `deduplication_key` CHAR(64) NULL,
    `status` ENUM('RECEIVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'IGNORED') NOT NULL DEFAULT 'RECEIVED',
    `target_url` VARCHAR(2048) NULL,
    `request_payload` JSON NOT NULL,
    `response_payload` JSON NULL,
    `http_status` SMALLINT UNSIGNED NULL,
    `attempt_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    `duration_ms` INTEGER UNSIGNED NULL,
    `error_message` TEXT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,
    `next_retry_at` DATETIME(3) NULL,

    UNIQUE INDEX `webhook_logs_public_id_key`(`public_id`),
    UNIQUE INDEX `webhook_logs_deduplication_key`(`deduplication_key`),
    INDEX `webhook_logs_tenant_received_at_idx`(`tenant_id`, `received_at` DESC),
    INDEX `webhook_logs_connection_received_at_idx`(`connection_id`, `received_at` DESC),
    INDEX `webhook_logs_status_retry_idx`(`status`, `next_retry_at`),
    INDEX `webhook_logs_direction_received_at_idx`(`direction`, `received_at` DESC),
    INDEX `webhook_logs_external_event_id_idx`(`external_event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsapp_connections` ADD CONSTRAINT `whatsapp_connections_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsapp_connections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_api_key_id_fkey` FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
