-- Passenger details, waitlist slots, user blocks.
-- New required Booking columns are added with temporary defaults, backfilled, then the defaults removed.

ALTER TABLE `ServiceTemplate` MODIFY `cancellationCloseTime` VARCHAR(191) NOT NULL DEFAULT '14:00';

ALTER TABLE `Booking` ADD COLUMN `guestPhone` VARCHAR(191) NULL,
    ADD COLUMN `idNumberEnc` VARCHAR(512) NULL,
    ADD COLUMN `idType` VARCHAR(191) NOT NULL DEFAULT 'IITD_ID',
    ADD COLUMN `passengerEmail` VARCHAR(191) NULL,
    ADD COLUMN `passengerName` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `passengerType` VARCHAR(191) NOT NULL DEFAULT 'SELF',
    ADD COLUMN `phone` VARCHAR(191) NULL,
    ADD COLUMN `piiPurgedAt` DATETIME(3) NULL,
    ADD COLUMN `purpose` VARCHAR(191) NOT NULL DEFAULT 'OTHER',
    ADD COLUMN `purposeDetail` VARCHAR(200) NULL,
    ADD COLUMN `selfSlot` VARCHAR(191) NOT NULL DEFAULT '',
    MODIFY `activeSlot` VARCHAR(191) NOT NULL DEFAULT 'SEAT1';

-- Backfill: legacy bookings were all for the account holder; purpose was not collected.
UPDATE `Booking` b JOIN `User` u ON u.`id` = b.`userId`
SET b.`passengerName` = u.`name`,
    b.`passengerEmail` = u.`email`,
    b.`purposeDetail` = 'Booked before purpose was collected',
    b.`selfSlot` = IF(b.`status` = 'CONFIRMED', 'SELF', b.`id`),
    b.`activeSlot` = IF(b.`activeSlot` = 'ACTIVE', 'SEAT1', b.`activeSlot`);

ALTER TABLE `Booking` ALTER COLUMN `idType` DROP DEFAULT,
    ALTER COLUMN `passengerName` DROP DEFAULT,
    ALTER COLUMN `purpose` DROP DEFAULT,
    ALTER COLUMN `selfSlot` DROP DEFAULT;

CREATE TABLE `UserBlock` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startsOn` VARCHAR(191) NOT NULL,
    `endsOn` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,
    `revokedById` VARCHAR(191) NULL,

    INDEX `UserBlock_userId_endsOn_idx`(`userId`, `endsOn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Booking_tripId_status_createdAt_idx` ON `Booking`(`tripId`, `status`, `createdAt`);
CREATE UNIQUE INDEX `Booking_userId_tripId_selfSlot_key` ON `Booking`(`userId`, `tripId`, `selfSlot`);

ALTER TABLE `UserBlock` ADD CONSTRAINT `UserBlock_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `UserBlock` ADD CONSTRAINT `UserBlock_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `UserBlock` ADD CONSTRAINT `UserBlock_revokedById_fkey` FOREIGN KEY (`revokedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: 2 PM cancellation cutoff (institute decision) and BUS / VAN service names.
UPDATE `ServiceTemplate` SET `cancellationCloseTime` = '14:00' WHERE `cancellationCloseTime` = '16:00';
UPDATE `ServiceTemplate` SET `serviceLabel` = 'BUS' WHERE `serviceLabel` = 'Bus 1';
UPDATE `ServiceTemplate` SET `serviceLabel` = 'VAN' WHERE `serviceLabel` = 'Bus 2';
UPDATE `Trip` SET `serviceLabel` = 'BUS' WHERE `serviceLabel` = 'Bus 1';
UPDATE `Trip` SET `serviceLabel` = 'VAN' WHERE `serviceLabel` = 'Bus 2';
UPDATE `Trip` SET `cancellationClosesAt` = `cancellationClosesAt` - INTERVAL 2 HOUR
WHERE `status` = 'SCHEDULED' AND `cancellationClosesAt` = `bookingClosesAt` AND `isSpecial` = false;
