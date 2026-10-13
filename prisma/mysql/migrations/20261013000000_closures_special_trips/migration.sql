-- AlterTable
ALTER TABLE `ServiceTemplate` MODIFY `cutoffRule` VARCHAR(191) NOT NULL DEFAULT 'PREVIOUS_CALENDAR_DAY';

-- AlterTable
ALTER TABLE `Trip` ADD COLUMN `isSpecial` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `ServiceClosure` (
    `id` VARCHAR(191) NOT NULL,
    `date` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ServiceClosure_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ServiceClosure` ADD CONSTRAINT `ServiceClosure_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

