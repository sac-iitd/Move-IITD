import type { PrismaClient } from '@prisma/client';
import { SCHEDULE_DEFAULTS, type Campus } from '@iitd-bus/shared';

interface TemplateSeed {
  code: string;
  serviceLabel: string;
  capacity: number;
  origin: Campus;
  destination: Campus;
  departureTime: string;
  timeProvisional?: boolean;
}

/**
 * The six weekday departures in the institute guideline (Oct 2026).
 * Bus Hauz Khas → Sonipat is 7:45 AM. Van Sonipat → Hauz Khas is 1:00 PM.
 */
export const SERVICE_TEMPLATE_SEED: readonly TemplateSeed[] = [
  {
    code: 'BUS1-0730-DEL-SNP',
    serviceLabel: 'BUS',
    capacity: 24,
    origin: 'DELHI',
    destination: 'SONIPAT',
    departureTime: '07:45',
  },
  {
    code: 'BUS1-1730-SNP-DEL',
    serviceLabel: 'BUS',
    capacity: 24,
    origin: 'SONIPAT',
    destination: 'DELHI',
    departureTime: '17:30',
  },
  {
    code: 'BUS2-0730-SNP-DEL',
    serviceLabel: 'VAN',
    capacity: 13,
    origin: 'SONIPAT',
    destination: 'DELHI',
    departureTime: '07:30',
  },
  {
    code: 'BUS2-1000-DEL-SNP',
    serviceLabel: 'VAN',
    capacity: 13,
    origin: 'DELHI',
    destination: 'SONIPAT',
    departureTime: '10:00',
  },
  {
    code: 'BUS2-1330-SNP-DEL',
    serviceLabel: 'VAN',
    capacity: 13,
    origin: 'SONIPAT',
    destination: 'DELHI',
    departureTime: '13:00',
  },
  {
    code: 'BUS2-1700-DEL-SNP',
    serviceLabel: 'VAN',
    capacity: 13,
    origin: 'DELHI',
    destination: 'SONIPAT',
    departureTime: '17:00',
  },
];

/**
 * Idempotently creates the seed templates. Existing templates are left untouched
 * so re-running the seed never overwrites admin edits.
 */
export async function seedServiceTemplates(prisma: PrismaClient, effectiveFrom: string) {
  let created = 0;
  for (const t of SERVICE_TEMPLATE_SEED) {
    const existing = await prisma.serviceTemplate.findUnique({ where: { code: t.code } });
    if (existing) continue;
    await prisma.serviceTemplate.create({
      data: {
        ...t,
        timeProvisional: t.timeProvisional ?? false,
        bookingOpenDaysBefore: SCHEDULE_DEFAULTS.bookingOpenDaysBefore,
        bookingOpenTime: SCHEDULE_DEFAULTS.bookingOpenTime,
        bookingCloseTime: SCHEDULE_DEFAULTS.bookingCloseTime,
        cancellationCloseTime: SCHEDULE_DEFAULTS.cancellationCloseTime,
        cutoffRule: SCHEDULE_DEFAULTS.cutoffRule,
        effectiveFrom,
      },
    });
    created++;
  }
  return { created, total: SERVICE_TEMPLATE_SEED.length };
}
