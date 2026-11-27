// Password hashing and session tokens. Node built-ins only — scrypt for
// passwords (salted, constant-time comparison), 256-bit random tokens for
// sessions. The JSON store persists both.
import crypto from 'node:crypto';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Bind code: 6 chars from an unambiguous alphabet (no 0/O/1/I).
export function newBindCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}
