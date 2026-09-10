import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const ENCODED_TIME_LENGTH = 10;
const ENCODED_RANDOM_LENGTH = 16;

/**
 * A ULID: 48 bits of millisecond timestamp then 80 bits of randomness, encoded
 * as 26 Crockford base32 characters.
 *
 * Used for every identifier. It sorts by creation time, which keeps a primary
 * key index appending rather than fragmenting, and it carries no sequence — so
 * one operator cannot enumerate another's servers by counting, which an
 * autoincrementing integer invites.
 *
 * Implemented here rather than taken as a dependency: it is thirty lines, and
 * the encoding is a published, frozen specification.
 */
export function ulid(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError(`Timestamp out of ULID range: ${now}`);
  }

  let time = '';
  let remaining = now;
  for (let i = ENCODED_TIME_LENGTH - 1; i >= 0; i--) {
    time = ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }

  const bytes = randomBytes(ENCODED_RANDOM_LENGTH);
  let random = '';
  for (let i = 0; i < ENCODED_RANDOM_LENGTH; i++) {
    // Each byte selects one symbol. Taking the low 5 bits of a uniform byte is
    // itself uniform over the 32-symbol alphabet, so there is no modulo bias.
    random += ALPHABET[bytes[i]! & 0x1f];
  }

  return time + random;
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

/**
 * A URL-safe secret for an API token or a refresh token.
 *
 * 32 bytes from the OS CSPRNG. Base64url so it survives a header, a query string
 * and a YAML file without escaping — the plugin puts one in `config.yml`.
 */
export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
