import type { PrismaClient, User } from '@prisma/client';
import {
  directionOf,
  type BoardingResult,
  type Campus,
  type ConductorDto,
  type ConductorHistoryDto,
  type UserRole,
} from '@iitd-bus/shared';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';

function toConductorDto(
  grant: {
    id: string;
    kerberosId: string;
    userId: string | null;
    active: boolean;
    grantedAt: Date;
    revokedAt: Date | null;
    user: { name: string; email: string | null; role: string } | null;
    grantedBy: { name: string } | null;
  },
  boardedCount: number,
  scanCount: number,
): ConductorDto {
  return {
    id: grant.id,
    kerberosId: grant.kerberosId,
    userId: grant.userId,
    name: grant.user?.name ?? null,
    email: grant.user?.email ?? null,
    role: (grant.user?.role as UserRole | undefined) ?? null,
    active: grant.active,
    grantedAt: grant.grantedAt.toISOString(),
    revokedAt: grant.revokedAt?.toISOString() ?? null,
    grantedByName: grant.grantedBy?.name ?? null,
    boardedCount,
    scanCount,
  };
}

async function scanTotals(prisma: PrismaClient, userIds: string[]) {
  const boarded = new Map<string, number>();
  const scans = new Map<string, number>();
  if (userIds.length === 0) return { boarded, scans };
  const rows = await prisma.boardingScan.groupBy({
    by: ['scannedById', 'result'],
    where: { scannedById: { in: userIds } },
    _count: { _all: true },
  });
  for (const row of rows) {
    scans.set(row.scannedById, (scans.get(row.scannedById) ?? 0) + row._count._all);
    if (row.result === 'BOARDED') boarded.set(row.scannedById, row._count._all);
  }
  return { boarded, scans };
}

export async function listConductors(prisma: PrismaClient): Promise<ConductorDto[]> {
  const grants = await prisma.conductorGrant.findMany({
    include: {
      user: { select: { name: true, email: true, role: true } },
      grantedBy: { select: { name: true } },
    },
    orderBy: [{ active: 'desc' }, { grantedAt: 'desc' }],
  });
  const totals = await scanTotals(
    prisma,
    grants.map((g) => g.userId).filter((id): id is string => id !== null),
  );
  return grants.map((g) =>
    toConductorDto(
      g,
      g.userId ? (totals.boarded.get(g.userId) ?? 0) : 0,
      g.userId ? (totals.scans.get(g.userId) ?? 0) : 0,
    ),
  );
}

/**
 * Lets a Kerberos id scan boarding passes. An administrator already can, so they are
 * not demoted into the conductor role. Access applies on the next sign-in if this
 * person has never signed in.
 */
export async function grantConductor(
  prisma: PrismaClient,
  input: { kerberosId: string; actor: User; now: Date },
) {
  const { kerberosId, actor, now } = input;
  const user = await prisma.user.findFirst({
    where: { providerSubject: kerberosId },
  });
  if (user?.role === 'ADMIN') {
    throw new HttpError(
      'CONFLICT',
      'This Kerberos id is an administrator. Administrators can already scan tickets.',
    );
  }
  const existing = await prisma.conductorGrant.findUnique({ where: { kerberosId } });
  if (existing?.active) {
    throw new HttpError('CONFLICT', 'This Kerberos id already has conductor access.');
  }

  const grant = existing
    ? await prisma.conductorGrant.update({
        where: { id: existing.id },
        data: {
          active: true,
          userId: user?.id ?? existing.userId,
          grantedById: actor.id,
          grantedAt: now,
          revokedAt: null,
          revokedById: null,
        },
      })
    : await prisma.conductorGrant.create({
        data: {
          kerberosId,
          userId: user?.id ?? null,
          grantedById: actor.id,
          grantedAt: now,
        },
      });

  if (user && user.role !== 'CONDUCTOR') {
    await prisma.user.update({ where: { id: user.id }, data: { role: 'CONDUCTOR' } });
  }
  await audit(prisma, {
    actorUserId: actor.id,
    action: 'CONDUCTOR_GRANTED',
    targetType: 'ConductorGrant',
    targetId: grant.id,
    metadata: { kerberosId, userId: user?.id ?? null },
  });
  const created = (await listConductors(prisma)).find((c) => c.id === grant.id);
  if (!created) throw new HttpError('INTERNAL', 'Conductor grant could not be loaded.');
  return created;
}

export async function revokeConductor(
  prisma: PrismaClient,
  input: { grantId: string; actor: User; now: Date },
) {
  const grant = await prisma.conductorGrant.findUnique({ where: { id: input.grantId } });
  if (!grant) throw new HttpError('NOT_FOUND', 'Conductor not found.');
  if (!grant.active) throw new HttpError('CONFLICT', 'Conductor access is already removed.');
  await prisma.conductorGrant.update({
    where: { id: grant.id },
    data: { active: false, revokedAt: input.now, revokedById: input.actor.id },
  });
  if (grant.userId) {
    const user = await prisma.user.findUnique({ where: { id: grant.userId } });
    if (user?.role === 'CONDUCTOR') {
      await prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });
    }
  }
  await audit(prisma, {
    actorUserId: input.actor.id,
    action: 'CONDUCTOR_REVOKED',
    targetType: 'ConductorGrant',
    targetId: grant.id,
    metadata: { kerberosId: grant.kerberosId },
  });
}

export async function conductorHistory(
  prisma: PrismaClient,
  grantId: string,
): Promise<ConductorHistoryDto> {
  const grant = await prisma.conductorGrant.findUnique({
    where: { id: grantId },
    include: {
      user: { select: { name: true, email: true, role: true } },
      grantedBy: { select: { name: true } },
    },
  });
  if (!grant) throw new HttpError('NOT_FOUND', 'Conductor not found.');
  const scans = grant.userId
    ? await prisma.boardingScan.findMany({
        where: { scannedById: grant.userId },
        include: {
          trip: true,
          booking: { select: { passengerName: true, bookingReference: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 1000,
      })
    : [];
  const totals = await scanTotals(prisma, grant.userId ? [grant.userId] : []);
  const trips = new Map<string, ConductorHistoryDto['trips'][number]>();
  for (const scan of scans) {
    let trip = trips.get(scan.tripId);
    if (!trip) {
      trip = {
        tripId: scan.tripId,
        travelDate: scan.trip.travelDate,
        departureTime: scan.trip.departureTime,
        serviceLabel: scan.trip.serviceLabel,
        direction: directionOf(scan.trip.origin as Campus, scan.trip.destination as Campus),
        boarded: 0,
        scans: [],
      };
      trips.set(scan.tripId, trip);
    }
    if (scan.result === 'BOARDED') trip.boarded++;
    trip.scans.push({
      at: scan.createdAt.toISOString(),
      result: scan.result as BoardingResult,
      passengerName: scan.booking?.passengerName ?? null,
      reference: scan.booking?.bookingReference ?? null,
    });
  }
  return {
    conductor: toConductorDto(
      grant,
      grant.userId ? (totals.boarded.get(grant.userId) ?? 0) : 0,
      grant.userId ? (totals.scans.get(grant.userId) ?? 0) : 0,
    ),
    trips: [...trips.values()],
  };
}

/** Applies or removes conductor access when someone signs in. Admins stay admins. */
export async function syncConductorRole(
  prisma: PrismaClient,
  user: User,
  kerberosId: string,
): Promise<User> {
  if (user.role === 'ADMIN') return user;
  const grant = await prisma.conductorGrant.findFirst({
    where: { kerberosId, active: true },
  });
  if (grant) {
    if (grant.userId !== user.id) {
      await prisma.conductorGrant.update({ where: { id: grant.id }, data: { userId: user.id } });
    }
    if (user.role === 'CONDUCTOR') return user;
    return prisma.user.update({ where: { id: user.id }, data: { role: 'CONDUCTOR' } });
  }
  if (user.role !== 'CONDUCTOR') return user;
  return prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });
}
