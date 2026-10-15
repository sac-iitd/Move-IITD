-- Data: Monday trips close on the preceding Friday (institute decision, Oct 2026).
-- Already generated Monday trips move both deadlines from Sunday to Friday (2 days earlier).
UPDATE "Trip" SET "bookingClosesAt" = "bookingClosesAt" - 172800000
WHERE "status" = 'SCHEDULED' AND "isSpecial" = 0 AND strftime('%w', "travelDate") = '1'
  AND "departureAt" - "bookingClosesAt" < 172800000
  AND "serviceTemplateId" IN (SELECT "id" FROM "ServiceTemplate" WHERE "cutoffRule" = 'PREVIOUS_CALENDAR_DAY');
UPDATE "Trip" SET "cancellationClosesAt" = "cancellationClosesAt" - 172800000
WHERE "status" = 'SCHEDULED' AND "isSpecial" = 0 AND strftime('%w', "travelDate") = '1'
  AND "departureAt" - "cancellationClosesAt" < 172800000
  AND "serviceTemplateId" IN (SELECT "id" FROM "ServiceTemplate" WHERE "cutoffRule" = 'PREVIOUS_CALENDAR_DAY');
UPDATE "ServiceTemplate" SET "cutoffRule" = 'PREVIOUS_OPERATIONAL_DAY' WHERE "cutoffRule" = 'PREVIOUS_CALENDAR_DAY';
