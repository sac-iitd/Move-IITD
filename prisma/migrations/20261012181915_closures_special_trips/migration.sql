-- CreateTable
CREATE TABLE "ServiceClosure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceClosure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
    "cancellationCloseTime" TEXT NOT NULL DEFAULT '16:00',
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
CREATE TABLE "new_Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceTemplateId" TEXT,
    "serviceLabel" TEXT NOT NULL,
    "travelDate" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "departureTime" TEXT NOT NULL,
    "departureAt" DATETIME NOT NULL,
    "capacity" INTEGER NOT NULL,
    "bookedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "timeProvisional" BOOLEAN NOT NULL DEFAULT false,
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "bookingOpensAt" DATETIME NOT NULL,
    "bookingClosesAt" DATETIME NOT NULL,
    "cancellationClosesAt" DATETIME NOT NULL,
    "cancellationReason" TEXT,
    "cancelledAt" DATETIME,
    "cancelledById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_serviceTemplateId_fkey" FOREIGN KEY ("serviceTemplateId") REFERENCES "ServiceTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Trip_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Trip" ("bookedCount", "bookingClosesAt", "bookingOpensAt", "cancellationClosesAt", "cancellationReason", "cancelledAt", "cancelledById", "capacity", "createdAt", "departureAt", "departureTime", "destination", "id", "origin", "serviceLabel", "serviceTemplateId", "status", "timeProvisional", "travelDate", "updatedAt") SELECT "bookedCount", "bookingClosesAt", "bookingOpensAt", "cancellationClosesAt", "cancellationReason", "cancelledAt", "cancelledById", "capacity", "createdAt", "departureAt", "departureTime", "destination", "id", "origin", "serviceLabel", "serviceTemplateId", "status", "timeProvisional", "travelDate", "updatedAt" FROM "Trip";
DROP TABLE "Trip";
ALTER TABLE "new_Trip" RENAME TO "Trip";
CREATE INDEX "Trip_travelDate_idx" ON "Trip"("travelDate");
CREATE INDEX "Trip_departureAt_idx" ON "Trip"("departureAt");
CREATE INDEX "Trip_status_idx" ON "Trip"("status");
CREATE UNIQUE INDEX "Trip_serviceTemplateId_travelDate_key" ON "Trip"("serviceTemplateId", "travelDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceClosure_date_key" ON "ServiceClosure"("date");
