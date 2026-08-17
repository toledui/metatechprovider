ALTER TABLE `users`
  ADD COLUMN `inbox_permissions` JSON NULL;

CREATE TABLE `inbox_teams` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(30) NOT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `color` CHAR(7) NOT NULL DEFAULT '#ff6b35',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `inbox_teams_public_id_key` (`public_id`),
  UNIQUE INDEX `inbox_teams_tenant_name_key` (`tenant_id`, `name`),
  INDEX `inbox_teams_tenant_created_idx` (`tenant_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `inbox_teams_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inbox_team_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `team_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `inbox_team_members_team_user_key` (`team_id`, `user_id`),
  INDEX `inbox_team_members_tenant_user_idx` (`tenant_id`, `user_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `inbox_team_members_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inbox_team_members_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `inbox_teams` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inbox_team_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `whatsapp_templates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(30) NOT NULL,
  `tenant_id` BIGINT UNSIGNED NOT NULL,
  `connection_id` BIGINT UNSIGNED NOT NULL,
  `meta_template_id` VARCHAR(64) NULL,
  `name` VARCHAR(512) NOT NULL,
  `language` VARCHAR(35) NOT NULL,
  `category` VARCHAR(40) NOT NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  `quality_score` VARCHAR(40) NULL,
  `rejection_reason` TEXT NULL,
  `components` JSON NOT NULL,
  `raw_payload` JSON NULL,
  `last_synced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `wa_templates_public_id_key` (`public_id`),
  UNIQUE INDEX `wa_templates_connection_name_language_key` (`connection_id`, `name`, `language`),
  INDEX `wa_templates_tenant_status_updated_idx` (`tenant_id`, `status`, `updated_at` DESC),
  INDEX `wa_templates_connection_meta_id_idx` (`connection_id`, `meta_template_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `whatsapp_templates_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `whatsapp_templates_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsapp_connections` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `conversation_assignments`
  ADD COLUMN `team_id` BIGINT UNSIGNED NULL,
  ADD INDEX `conversation_assignments_team_id_active_idx` (`tenant_id`, `team_id`, `ended_at`),
  ADD CONSTRAINT `conversation_assignments_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `inbox_teams` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `messages`
  ADD COLUMN `retry_of_message_id` BIGINT UNSIGNED NULL,
  ADD INDEX `messages_retry_of_idx` (`retry_of_message_id`),
  ADD CONSTRAINT `messages_retry_of_message_id_fkey` FOREIGN KEY (`retry_of_message_id`) REFERENCES `messages` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
