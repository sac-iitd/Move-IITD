import type { PrismaClient, User } from '@prisma/client';
import type { Env } from '../config/env';
import { audit } from '../lib/audit';
import { syncConductorRole } from '../conductors/service';
import type { ProviderIdentity } from './provider';

export type EligibilityResult = { ok: true } | { ok: false; reason: string };

/** Optional institution-configured restrictions on who may use the service. */
export function checkEligibility(env: Env, identity: ProviderIdentity): EligibilityResult {
  const domains = env.KEBROS_ALLOWED_EMAIL_DOMAINS.map((d) => d.toLowerCase());
  if (domains.length > 0) {
    const domain = identity.email?.split('@')[1];
    if (!domain || !domains.includes(domain)) return { ok: false, reason: 'email_domain' };
  }
  const categories = env.KEBROS_ALLOWED_CATEGORIES.map((c) => c.toLowerCase());
  if (categories.length > 0) {
    if (!identity.category || !categories.includes(identity.category)) {
      return { ok: false, reason: 'category' };
    }
  }
  return { ok: true };
}

/**
 * ADMIN_ALLOWLIST entries containing "@" match the provider-verified email
 * (`mail` claim); other entries match the Kerberos `user_id` (subject).
 */
export function isAllowlistedAdmin(env: Env, identity: ProviderIdentity): boolean {
  return env.ADMIN_ALLOWLIST.some((entry) => {
    const e = entry.toLowerCase();
    return e.includes('@') ? identity.email === e : identity.subject === e;
  });
}

/**
 * Creates or refreshes the local user for a verified identity, keyed by
 * (provider, subject). Admin is granted only via the server-side allowlist
 * or the create-admin CLI — never from client input.
 */
export async function upsertUserFromIdentity(
  prisma: PrismaClient,
  env: Env,
  providerKey: string,
  identity: ProviderIdentity,
  now: Date,
): Promise<User> {
  const where = {
    authProvider_providerSubject: { authProvider: providerKey, providerSubject: identity.subject },
  };
  const profile = {
    name: identity.name,
    email: identity.email,
    category: identity.category,
    lastLoginAt: now,
  };
  let user = await prisma.user.upsert({
    where,
    create: { authProvider: providerKey, providerSubject: identity.subject, ...profile },
    update: profile,
  });

  // In production only the real provider exists (dev-mock is rejected at startup).
  if (isAllowlistedAdmin(env, identity) && user.role !== 'ADMIN') {
    user = await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
    await audit(prisma, {
      actorUserId: null,
      action: 'ROLE_GRANTED',
      targetType: 'User',
      targetId: user.id,
      metadata: {
        role: 'ADMIN',
        via: 'ADMIN_ALLOWLIST',
        subject: identity.subject,
        email: identity.email,
      },
    });
  }
  return syncConductorRole(prisma, user, identity.subject);
}
