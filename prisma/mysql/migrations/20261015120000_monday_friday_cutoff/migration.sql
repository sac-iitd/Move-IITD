-- Data: Monday trips close on the preceding Friday (institute decision, Oct 2026).
-- Already generated Monday trips move both deadlines from Sunday to Friday (2 days earlier).
UPDATE `Trip` SET `bookingClosesAt` = `bookingClosesAt` - INTERVAL 2 DAY
WHERE `status` = 'SCHEDULED' AND `isSpecial` = false AND DAYOFWEEK(`travelDate`) = 2
  AND `bookingClosesAt` > `departureAt` - INTERVAL 2 DAY
  AND `serviceTemplateId` IN (SELECT `id` FROM `ServiceTemplate` WHERE `cutoffRule` = 'PREVIOUS_CALENDAR_DAY');
UPDATE `Trip` SET `cancellationClosesAt` = `cancellationClosesAt` - INTERVAL 2 DAY
WHERE `status` = 'SCHEDULED' AND `isSpecial` = false AND DAYOFWEEK(`travelDate`) = 2
  AND `cancellationClosesAt` > `departureAt` - INTERVAL 2 DAY
  AND `serviceTemplateId` IN (SELECT `id` FROM `ServiceTemplate` WHERE `cutoffRule` = 'PREVIOUS_CALENDAR_DAY');
UPDATE `ServiceTemplate` SET `cutoffRule` = 'PREVIOUS_OPERATIONAL_DAY' WHERE `cutoffRule` = 'PREVIOUS_CALENDAR_DAY';
