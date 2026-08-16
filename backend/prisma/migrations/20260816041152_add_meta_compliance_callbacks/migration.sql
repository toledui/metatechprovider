-- AlterTable
ALTER TABLE `whatsapp_connections` ADD COLUMN `meta_user_id` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `data_deletion_requests` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NULL,
    `request_hash` CHAR(64) NOT NULL,
    `confirmation_code_hash` CHAR(64) NOT NULL,
    `meta_user_id_hash` CHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `affected_connections` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completed_at` DATETIME(3) NULL,
    `error_message` TEXT NULL,

    UNIQUE INDEX `data_deletion_requests_public_id_key`(`public_id`),
    UNIQUE INDEX `data_deletion_requests_request_hash_key`(`request_hash`),
    UNIQUE INDEX `data_deletion_requests_confirmation_code_hash_key`(`confirmation_code_hash`),
    INDEX `data_deletion_requests_status_requested_idx`(`status`, `requested_at` DESC),
    INDEX `data_deletion_requests_meta_user_requested_idx`(`meta_user_id_hash`, `requested_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `wa_connections_meta_user_id_idx` ON `whatsapp_connections`(`meta_user_id`);

-- AddForeignKey
ALTER TABLE `data_deletion_requests` ADD CONSTRAINT `data_deletion_requests_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
