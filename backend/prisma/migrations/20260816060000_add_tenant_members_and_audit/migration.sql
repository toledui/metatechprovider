-- CreateTable
CREATE TABLE `tenant_invitations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `invited_by_user_id` BIGINT UNSIGNED NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'MEMBER') NOT NULL DEFAULT 'MEMBER',
    `token_hash` CHAR(64) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tenant_invitations_public_id_key`(`public_id`),
    UNIQUE INDEX `tenant_invitations_token_hash_key`(`token_hash`),
    INDEX `tenant_invitations_tenant_status_created_idx`(`tenant_id`, `status`, `created_at` DESC),
    INDEX `tenant_invitations_tenant_email_status_idx`(`tenant_id`, `email`, `status`),
    INDEX `tenant_invitations_expiry_status_idx`(`expires_at`, `status`),
    CONSTRAINT `tenant_invitations_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `tenant_invitations_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(30) NOT NULL,
    `tenant_id` BIGINT UNSIGNED NOT NULL,
    `actor_user_id` BIGINT UNSIGNED NULL,
    `action` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_public_id` VARCHAR(30) NULL,
    `metadata` JSON NULL,
    `ip_address` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `audit_logs_public_id_key`(`public_id`),
    INDEX `audit_logs_tenant_created_at_idx`(`tenant_id`, `created_at` DESC),
    INDEX `audit_logs_tenant_action_created_idx`(`tenant_id`, `action`, `created_at` DESC),
    INDEX `audit_logs_actor_created_at_idx`(`actor_user_id`, `created_at` DESC),
    CONSTRAINT `audit_logs_tenant_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
