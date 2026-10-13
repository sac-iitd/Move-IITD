import { z } from 'zod';
import { AuthProviderError, type AuthProvider, type ProviderIdentity } from './provider';

/**
 * DEVELOPMENT-ONLY identity provider. It lets developers pick an identity on a
 * local page so the app can be exercised without IIT Delhi OAuth credentials.
 *
 * Guards: env validation rejects AUTH_PROVIDER=dev-mock in production and
 * requires AUTH_DEV_MOCK_ENABLED=true elsewhere; the constructor re-checks.
 * Users created through it are stored with authProvider="dev-mock", so they
 * can never collide with real KEBROS identities.
 */

const identitySchema = z.object({
  subject: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{2,40}$/),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().nullable(),
  category: z.string().trim().toLowerCase().max(40).nullable(),
});

export class DevMockAuthProvider implements AuthProvider {
  readonly key = 'dev-mock';

  constructor(nodeEnv: string) {
    if (nodeEnv === 'production')
      throw new Error('DevMockAuthProvider must never run in production');
  }

  authorizationUrl(state: string): string {
    // Relative, so it stays on whichever origin the browser is using (e.g. the Vite proxy).
    return `/api/v1/auth/dev-mock/authorize?state=${encodeURIComponent(state)}`;
  }

  static encodeCode(identity: ProviderIdentity): string {
    return Buffer.from(JSON.stringify(identity)).toString('base64url');
  }

  async exchangeCode(code: string): Promise<ProviderIdentity> {
    try {
      return identitySchema.parse(JSON.parse(Buffer.from(code, 'base64url').toString('utf8')));
    } catch {
      throw new AuthProviderError('INVALID_PROFILE', 'Invalid dev-mock code');
    }
  }
}

export function devMockAuthorizePage(state: string, callbackPath: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const presets = [
    {
      subject: 'devstudent1',
      name: 'Dev Student One',
      email: 'devstudent1@iitd.ac.in',
      category: 'student',
    },
    {
      subject: 'devstudent2',
      name: 'Dev Student Two',
      email: 'devstudent2@iitd.ac.in',
      category: 'student',
    },
    { subject: 'devadmin', name: 'Dev Admin', email: 'devadmin@iitd.ac.in', category: 'staff' },
  ];
  const options = presets
    .map(
      (p) =>
        `<li><a href="${esc(`${callbackPath}?state=${encodeURIComponent(state)}&code=${DevMockAuthProvider.encodeCode(p)}`)}">${esc(p.name)} <small>(${esc(p.subject)}, ${esc(p.category)})</small></a></li>`,
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev mock sign-in</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#1f1310}
.warn{background:#fff3cd;border:1px solid #e0b100;padding:.75rem;border-radius:.5rem}a{color:#7a4b00}li{margin:.5rem 0}</style></head>
<body><p class="warn"><strong>Development only.</strong> This page simulates the IIT Delhi KEBROS sign-in. It is disabled in production.</p>
<h1>Choose a test identity</h1><ul>${options}</ul></body></html>`;
}
