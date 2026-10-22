-- CreateTable
CREATE TABLE "ConductorGrant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kerberosId" TEXT NOT NULL,
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "grantedById" TEXT,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokedById" TEXT,
    CONSTRAINT "ConductorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ConductorGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ConductorGrant_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BoardingScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT,
    "tripId" TEXT NOT NULL,
    "scannedById" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardingScan_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "BoardingScan_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BoardingScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "idTypeDetail" TEXT,
    "idNumberEnc" TEXT,
    "piiPurgedAt" DATETIME,
    "idempotencyKey" TEXT,
    "bookedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "cancelledById" TEXT,
    "boardingToken" TEXT,
    "boardedAt" DATETIME,
    "boardedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Booking_boardedById_fkey" FOREIGN KEY ("boardedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("activeSlot", "bookedAt", "bookingReference", "cancellationReason", "cancelledAt", "cancelledById", "createdAt", "guestPhone", "id", "idNumberEnc", "idType", "idTypeDetail", "idempotencyKey", "passengerEmail", "passengerName", "passengerType", "phone", "piiPurgedAt", "purpose", "purposeDetail", "selfSlot", "status", "tripId", "updatedAt", "userId") SELECT "activeSlot", "bookedAt", "bookingReference", "cancellationReason", "cancelledAt", "cancelledById", "createdAt", "guestPhone", "id", "idNumberEnc", "idType", "idTypeDetail", "idempotencyKey", "passengerEmail", "passengerName", "passengerType", "phone", "piiPurgedAt", "purpose", "purposeDetail", "selfSlot", "status", "tripId", "updatedAt", "userId" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_bookingReference_key" ON "Booking"("bookingReference");
CREATE UNIQUE INDEX "Booking_boardingToken_key" ON "Booking"("boardingToken");
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
CREATE UNIQUE INDEX "ConductorGrant_kerberosId_key" ON "ConductorGrant"("kerberosId");

-- CreateIndex
CREATE UNIQUE INDEX "ConductorGrant_userId_key" ON "ConductorGrant"("userId");

-- CreateIndex
CREATE INDEX "ConductorGrant_active_idx" ON "ConductorGrant"("active");

-- CreateIndex
CREATE INDEX "BoardingScan_scannedById_createdAt_idx" ON "BoardingScan"("scannedById", "createdAt");

-- CreateIndex
CREATE INDEX "BoardingScan_tripId_createdAt_idx" ON "BoardingScan"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "BoardingScan_bookingId_idx" ON "BoardingScan"("bookingId");

