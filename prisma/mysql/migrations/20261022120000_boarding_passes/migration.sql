-- Boarding QR passes and conductor scan history.

ALTER TABLE `Booking`
    ADD COLUMN `boardingToken` VARCHAR(191) NULL,
    ADD COLUMN `boardedAt` DATETIME(3) NULL,
    ADD COLUMN `boardedById` VARCHAR(191) NULL;

CREATE UNIQUE INDEX `Booking_boardingToken_key` ON `Booking`(`boardingToken`);

ALTER TABLE `Booking`
    ADD CONSTRAINT `Booking_boardedById_fkey` FOREIGN KEY (`boardedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `ConductorGrant` (
    `id` VARCHAR(191) NOT NULL,
    `kerberosId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `grantedById` VARCHAR(191) NULL,
    `grantedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedById` VARCHAR(191) NULL,

    UNIQUE INDEX `ConductorGrant_kerberosId_key`(`kerberosId`),
    UNIQUE INDEX `ConductorGrant_userId_key`(`userId`),
    INDEX `ConductorGrant_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ConductorGrant`
    ADD CONSTRAINT `ConductorGrant_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ConductorGrant_grantedById_fkey` FOREIGN KEY (`grantedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `ConductorGrant_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `BoardingScan` (
    `id` VARCHAR(191) NOT NULL,
    `bookingId` VARCHAR(191) NULL,
    `tripId` VARCHAR(191) NOT NULL,
    `scannedById` VARCHAR(191) NOT NULL,
    `result` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `BoardingScan_scannedById_createdAt_idx`(`scannedById`, `createdAt`),
    INDEX `BoardingScan_tripId_createdAt_idx`(`tripId`, `createdAt`),
    INDEX `BoardingScan_bookingId_idx`(`bookingId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `BoardingScan`
    ADD CONSTRAINT `BoardingScan_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT `BoardingScan_tripId_fkey` FOREIGN KEY (`tripId`) REFERENCES `Trip`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT `BoardingScan_scannedById_fkey` FOREIGN KEY (`scannedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
