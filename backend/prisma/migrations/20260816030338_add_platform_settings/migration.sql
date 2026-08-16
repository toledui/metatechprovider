-- CreateTable
CREATE TABLE `platform_settings` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(50) NOT NULL,
    `config_encrypted` TEXT NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `updated_by_user_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `platform_settings_provider_key`(`provider`),
    INDEX `platform_settings_enabled_updated_idx`(`enabled`, `updated_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `platform_settings` ADD CONSTRAINT `platform_settings_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
