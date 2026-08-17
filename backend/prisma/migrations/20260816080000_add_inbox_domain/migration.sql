-- CreateTable
CREATE TABLE `contacts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `wa_id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NULL,
    `profile_name` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `contacts_public_id_key`(`public_id`),
    UNIQUE INDEX `contacts_tenant_wa_id_key`(`tenant_id`, `wa_id`),
    INDEX `contacts_tenant_name_idx`(`tenant_id`, `name`),
    CONSTRAINT `contacts_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `contact_id` BIGINT UNSIGNED NOT NULL,
    `connection_id` BIGINT UNSIGNED NOT NULL,
    `status` ENUM('OPEN', 'PENDING', 'RESOLVED') NOT NULL DEFAULT 'OPEN',
    `subject` VARCHAR(191) NULL,
    `last_message_at` DATETIME(3) NULL,
    `last_inbound_at` DATETIME(3) NULL,
    `last_outbound_at` DATETIME(3) NULL,
    `last_message_preview` VARCHAR(500) NULL,
    `unread_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `conversations_public_id_key`(`public_id`),
    UNIQUE INDEX `conversations_contact_connection_key`(`contact_id`, `connection_id`),
    INDEX `conversations_tenant_status_last_message_idx`(`tenant_id`, `status`, `last_message_at` DESC),
    INDEX `conversations_tenant_unread_last_message_idx`(`tenant_id`, `unread_count`, `last_message_at` DESC),
    CONSTRAINT `conversations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversations_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsapp_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `connection_id` BIGINT UNSIGNED NOT NULL,
    `sender_user_id` BIGINT UNSIGNED NULL,
    `external_id` VARCHAR(191) NULL,
    `direction` ENUM('INBOUND', 'OUTBOUND') NOT NULL,
    `type` ENUM('TEXT', 'TEMPLATE', 'IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'STICKER', 'INTERACTIVE', 'LOCATION', 'CONTACTS', 'REACTION', 'UNKNOWN') NOT NULL,
    `status` ENUM('RECEIVED', 'SENT', 'DELIVERED', 'READ', 'FAILED') NOT NULL,
    `text_body` TEXT NULL,
    `content` JSON NOT NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `read_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `messages_public_id_key`(`public_id`),
    UNIQUE INDEX `messages_external_id_key`(`external_id`),
    INDEX `messages_conversation_created_idx`(`conversation_id`, `created_at`),
    INDEX `messages_tenant_status_updated_idx`(`tenant_id`, `status`, `updated_at` DESC),
    CONSTRAINT `messages_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `messages_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsapp_connections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `messages_sender_user_id_fkey` FOREIGN KEY (`sender_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversation_assignments` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `assigned_user_id` BIGINT UNSIGNED NULL,
    `team_name` VARCHAR(100) NULL,
    `assigned_by_user_id` BIGINT UNSIGNED NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,

    UNIQUE INDEX `conversation_assignments_public_id_key`(`public_id`),
    INDEX `conversation_assignments_active_idx`(`conversation_id`, `ended_at`, `created_at` DESC),
    INDEX `conversation_assignments_user_active_idx`(`tenant_id`, `assigned_user_id`, `ended_at`),
    INDEX `conversation_assignments_team_active_idx`(`tenant_id`, `team_name`, `ended_at`),
    CONSTRAINT `conversation_assignments_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversation_assignments_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `conversation_assignments_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT `conversation_assignments_assigned_by_user_id_fkey` FOREIGN KEY (`assigned_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `color` CHAR(7) NOT NULL DEFAULT '#ff6b35',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tags_public_id_key`(`public_id`),
    UNIQUE INDEX `tags_tenant_name_key`(`tenant_id`, `name`),
    INDEX `tags_tenant_created_idx`(`tenant_id`, `created_at`),
    CONSTRAINT `tags_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `internal_notes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `conversation_id` BIGINT UNSIGNED NOT NULL,
    `author_user_id` BIGINT UNSIGNED NOT NULL,
    `body` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `internal_notes_public_id_key`(`public_id`),
    INDEX `internal_notes_conversation_created_idx`(`conversation_id`, `created_at`),
    CONSTRAINT `internal_notes_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `internal_notes_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `internal_notes_author_user_id_fkey` FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_ConversationToTag` (
    `A` BIGINT UNSIGNED NOT NULL,
    `B` BIGINT UNSIGNED NOT NULL,

    UNIQUE INDEX `_ConversationToTag_AB_unique`(`A`, `B`),
    INDEX `_ConversationToTag_B_index`(`B`),
    CONSTRAINT `_ConversationToTag_A_fkey` FOREIGN KEY (`A`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `_ConversationToTag_B_fkey` FOREIGN KEY (`B`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
