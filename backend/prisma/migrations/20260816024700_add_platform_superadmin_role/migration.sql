-- AlterTable
ALTER TABLE `users` ADD COLUMN `platform_role` ENUM('USER', 'SUPERADMIN') NOT NULL DEFAULT 'USER';

-- CreateIndex
CREATE INDEX `users_platform_role_status_idx` ON `users`(`platform_role`, `status`);
