import crypto from 'node:crypto';
import type { Env } from '../config/env';

/**
 * Encrypts guest ID-proof numbers (Aadhaar / PAN) at rest with AES-256-GCM.
 * Stored format: "v1.<iv>.<tag>.<ciphertext>" (base64url). A random IV per value means
 * equal numbers never produce equal ciphertexts. Plaintext is only produced for admins
 * (manifest, export, booking detail) and those reads are audited by the callers.
 */

let key: Buffer | undefined;

export function configureIdCipher(
  env: Pick<Env, 'ID_ENCRYPTION_KEY' | 'SESSION_SECRET' | 'NODE_ENV'>,
) {
  if (!env.ID_ENCRYPTION_KEY && env.NODE_ENV === 'production') {
    throw new Error('ID_ENCRYPTION_KEY is required in production');
  }
  // Outside production a key derived from the session secret keeps local setup simple.
  const material = env.ID_ENCRYPTION_KEY ?? `dev-only:${env.SESSION_SECRET}`;
  key = crypto.createHash('sha256').update(`iitd-bus-id:${material}`).digest();
}

function requireKey(): Buffer {
  if (!key) throw new Error('ID cipher not configured');
  return key;
}

export function encryptIdNumber(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ct]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Returns null for missing values or values that cannot be decrypted (e.g. wrong key). */
export function decryptIdNumber(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, iv, tag, ct] = stored.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) return null;
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      requireKey(),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
