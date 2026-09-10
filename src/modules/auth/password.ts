import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * `promisify` picks the three-argument overload, which drops the cost
 * parameters — so the signature is restated rather than inferred.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * scrypt parameters. `N` is the cost; 2^16 with `r = 8` needs about 64 MB per
 * hash, which is the point — it is what makes a stolen table expensive to attack
 * rather than merely slow.
 */
const N = 65536;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * Hashes a password with scrypt, from `node:crypto`.
 *
 * Argon2id would be the first choice, but every Node binding for it is a native
 * module that has to compile on the deployment machine. scrypt is memory-hard,
 * standardised in RFC 7914, and ships with the runtime — a materially better
 * trade than a build step for a service whose whole dependency list is five
 * packages.
 *
 * The encoding carries its own parameters (`scrypt$N$r$p$salt$hash`) so a later
 * increase in cost can be applied to new passwords while old ones still verify.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });

  return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed hash: a corrupted row
 * should fail the login, not the process.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let expected: Buffer;
  try {
    expected = Buffer.from(parts[5]!, 'base64url');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;

  const salt = Buffer.from(parts[4]!, 'base64url');
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: n,
    r,
    p,
    maxmem: 256 * 1024 * 1024,
  });

  // Constant-time: a byte-by-byte comparison leaks how much of the hash matched.
  return timingSafeEqual(derived, expected);
}

/**
 * True when the stored hash was produced with weaker parameters than the current
 * ones, so it should be rehashed on the next successful login.
 */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < N || Number(parts[2]) < R || Number(parts[3]) < P;
}
