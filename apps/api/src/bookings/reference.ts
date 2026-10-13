import crypto from 'node:crypto';

// Crockford base32 (no I, L, O, U) — easy to read aloud and type.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Generates a booking reference like "SNP-7K3M-Q9XD" (40 random bits).
 * References are hard to guess, but access control — not secrecy — protects
 * bookings: only the owner or an admin can view one.
 */
export function generateBookingReference(): string {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i]! & 31];
  return `SNP-${out.slice(0, 4)}-${out.slice(4)}`;
}
