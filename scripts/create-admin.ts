/**
 * Grants or revokes the ADMIN role for a KEBROS identity. Requires shell access
 * to the server (and its DATABASE_URL), so it cannot be invoked by web users.
 *
 *   npm run admin:create -- --subject cs1200123            # grant
 *   npm run admin:create -- --subject cs1200123 --revoke   # revoke
 *   npm run admin:create -- --list
 *
 * --subject is the IIT Delhi OAuth `user_id` (Kerberos ID). If the person has
 * never signed in, a placeholder user is created and their name/email are
 * filled in from the provider at first sign-in.
 * --provider defaults to "kebros" (use "dev-mock" only for local development).
 */
import { PrismaClient } from '@prisma/client';
import { audit } from '../apps/api/src/lib/audit';

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--list')) {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
      orderBy: { name: 'asc' },
    });
    for (const a of admins)
      console.log(`${a.authProvider}:${a.providerSubject}\t${a.name}\t${a.email ?? ''}`);
    if (admins.length === 0) console.log('No admins.');
    return;
  }

  const subject = arg('subject')?.trim().toLowerCase();
  const provider = arg('provider') ?? 'kebros';
  const revoke = process.argv.includes('--revoke');
  if (!subject || !/^[a-z0-9._-]{2,64}$/.test(subject)) {
    throw new Error('Usage: --subject <kerberos-id> [--revoke] [--provider kebros|dev-mock]');
  }
  if (provider === 'dev-mock' && process.env.NODE_ENV === 'production') {
    throw new Error('dev-mock identities cannot be granted admin in production');
  }

  const where = {
    authProvider_providerSubject: { authProvider: provider, providerSubject: subject },
  };
  const role = revoke ? 'USER' : 'ADMIN';
  const user = await prisma.user.upsert({
    where,
    create: { authProvider: provider, providerSubject: subject, name: subject, role },
    update: { role },
  });
  await audit(prisma, {
    actorUserId: null,
    action: revoke ? 'ROLE_REVOKED' : 'ROLE_GRANTED',
    targetType: 'User',
    targetId: user.id,
    metadata: { role, via: 'CLI', subject, provider },
  });
  console.log(`${revoke ? 'Revoked' : 'Granted'} ADMIN for ${provider}:${subject}.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
