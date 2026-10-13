-- CreateTable
CREATE TABLE "UserBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "UserBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "UserBlock_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "serviceLabel" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "timeProvisional" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "bookingOpenDaysBefore" INTEGER NOT NULL DEFAULT 7,
    "bookingOpenTime" TEXT NOT NULL DEFAULT '00:00',
    "bookingCloseTime" TEXT NOT NULL DEFAULT '16:00',
    "cancellationCloseTime" TEXT NOT NULL DEFAULT '14:00',
    "cutoffRule" TEXT NOT NULL DEFAULT 'PREVIOUS_CALENDAR_DAY',
    "effectiveFrom" TEXT NOT NULL,
    "effectiveUntil" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ServiceTemplate" ("active", "bookingCloseTime", "bookingOpenDaysBefore", "bookingOpenTime", "cancellationCloseTime", "capacity", "code", "createdAt", "cutoffRule", "departureTime", "destination", "effectiveFrom", "effectiveUntil", "id", "origin", "serviceLabel", "timeProvisional", "updatedAt") SELECT "active", "bookingCloseTime", "bookingOpenDaysBefore", "bookingOpenTime", "cancellationCloseTime", "capacity", "code", "createdAt", "cutoffRule", "departureTime", "destination", "effectiveFrom", "effectiveUntil", "id", "origin", "serviceLabel", "timeProvisional", "updatedAt" FROM "ServiceTemplate";
DROP TABLE "ServiceTemplate";
ALTER TABLE "new_ServiceTemplate" RENAME TO "ServiceTemplate";
CREATE UNIQUE INDEX "ServiceTemplate_code_key" ON "ServiceTemplate"("code");
CREATE TABLE "new_Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingReference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "activeSlot" TEXT NOT NULL DEFAULT 'SEAT1',
    "selfSlot" TEXT NOT NULL,
    "passengerType" TEXT NOT NULL DEFAULT 'SELF',
    "passengerName" TEXT NOT NULL,
    "passengerEmail" TEXT,
    "phone" TEXT,
    "guestPhone" TEXT,
    "purpose" TEXT NOT NULL,
    "purposeDetail" TEXT,
    "idType" TEXT NOT NULL,
    "idNumberEnc" TEXT,
    "piiPurgedAt" DATETIME,
    "idempotencyKey" TEXT,
    "bookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "cancelledById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Backfill: legacy bookings were all for the account holder; purpose was not collected.
INSERT INTO "new_Booking" ("activeSlot", "selfSlot", "passengerType", "passengerName", "passengerEmail", "purpose", "purposeDetail", "idType", "bookedAt", "bookingReference", "cancellationReason", "cancelledAt", "cancelledById", "createdAt", "id", "idempotencyKey", "status", "tripId", "updatedAt", "userId")
SELECT CASE WHEN b."activeSlot" = 'ACTIVE' THEN 'SEAT1' ELSE b."activeSlot" END,
       CASE WHEN b."status" = 'CONFIRMED' THEN 'SELF' ELSE b."id" END,
       'SELF', u."name", u."email", 'OTHER', 'Booked before purpose was collected', 'IITD_ID',
       b."bookedAt", b."bookingReference", b."cancellationReason", b."cancelledAt", b."cancelledById", b."createdAt", b."id", b."idempotencyKey", b."status", b."tripId", b."updatedAt", b."userId"
FROM "Booking" b JOIN "User" u ON u."id" = b."userId";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_bookingReference_key" ON "Booking"("bookingReference");
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");
CREATE INDEX "Booking_tripId_idx" ON "Booking"("tripId");
CREATE INDEX "Booking_status_idx" ON "Booking"("status");
CREATE INDEX "Booking_tripId_status_createdAt_idx" ON "Booking"("tripId", "status", "createdAt");
CREATE UNIQUE INDEX "Booking_userId_tripId_activeSlot_key" ON "Booking"("userId", "tripId", "activeSlot");
CREATE UNIQUE INDEX "Booking_userId_tripId_selfSlot_key" ON "Booking"("userId", "tripId", "selfSlot");
CREATE UNIQUE INDEX "Booking_userId_idempotencyKey_key" ON "Booking"("userId", "idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserBlock_userId_endsOn_idx" ON "UserBlock"("userId", "endsOn");


-- Data: 2 PM cancellation cutoff (institute decision) and BUS / VAN service names.
UPDATE "ServiceTemplate" SET "cancellationCloseTime" = '14:00' WHERE "cancellationCloseTime" = '16:00';
UPDATE "ServiceTemplate" SET "serviceLabel" = 'BUS' WHERE "serviceLabel" = 'Bus 1';
UPDATE "ServiceTemplate" SET "serviceLabel" = 'VAN' WHERE "serviceLabel" = 'Bus 2';
UPDATE "Trip" SET "serviceLabel" = 'BUS' WHERE "serviceLabel" = 'Bus 1';
UPDATE "Trip" SET "serviceLabel" = 'VAN' WHERE "serviceLabel" = 'Bus 2';
-- Future scheduled trips: move the cancellation deadline from 16:00 to 14:00 IST (2 hours earlier).
UPDATE "Trip" SET "cancellationClosesAt" = "cancellationClosesAt" - 7200000
WHERE "status" = 'SCHEDULED' AND "cancellationClosesAt" = "bookingClosesAt" AND "isSpecial" = 0;
