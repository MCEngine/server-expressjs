import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { secretToken } from '../../lib/ids.js';

export const API_TOKEN_PREFIX = 'mcpm_';
const PREFIX_LENGTH = 8;

/**
 * Every scope an API token can carry. A route names the one it needs; a token
 * without it gets 403, never 404 — the caller is authenticated, and hiding
 * existence from them only makes the failure harder to debug.
 */
export const SCOPES = [
  'artifact:read',
  'artifact:write',
  'product:write',
  'fleet:read',
  'fleet:write',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

/** SHA-256, hex. What is stored for an API token and a refresh token. */
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Compares two hex digests in constant time.
 *
 * The prefix index narrows a lookup to a handful of rows, so a plain `===` here
 * would leak which of them matched further — small, but free to avoid.
 */
export function digestMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export interface MintedApiToken {
  /** Shown once, at creation. The service never has it again. */
  readonly token: string;
  readonly prefix: string;
  readonly hash: string;
}

/**
 * Mints an API token: a recognisable prefix, then a non-secret lookup segment,
 * then the secret.
 *
 * `mcpm_` makes the two bearer forms tell-apart-able without guessing — a JWT
 * never starts with it. The eight-character lookup segment is indexed, so
 * authenticating a download is one index hit and one hash comparison rather than
 * hashing the candidate against every row.
 */
export function mintApiToken(): MintedApiToken {
  const prefix = secretToken(6).slice(0, PREFIX_LENGTH).padEnd(PREFIX_LENGTH, '0');
  const secret = secretToken(32);
  const token = `${API_TOKEN_PREFIX}${prefix}${secret}`;
  return { token, prefix, hash: digest(token) };
}

export interface ParsedApiToken {
  readonly prefix: string;
  readonly hash: string;
}

/** Splits a presented token into its lookup prefix and its digest. */
export function parseApiToken(presented: string): ParsedApiToken | undefined {
  if (!presented.startsWith(API_TOKEN_PREFIX)) return undefined;
  const body = presented.slice(API_TOKEN_PREFIX.length);
  if (body.length < PREFIX_LENGTH + 16) return undefined;
  return { prefix: body.slice(0, PREFIX_LENGTH), hash: digest(presented) };
}

export interface AccessClaims extends JWTPayload {
  sub: string;
  sid: string;
}

/**
 * Signs a short-lived access token.
 *
 * `jose` rather than a hand-rolled HS256: the algorithm is pinned on both sides,
 * which is the defence against the confusion attacks that make "verify a JWT" a
 * bad thing to write yourself.
 */
export async function signAccessToken(
  secret: Uint8Array,
  accountId: string,
  sessionId: string,
  ttlSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(accountId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer('mcpluginmanager')
    .setAudience('mcpluginmanager-api')
    .sign(secret);
}

/** Verifies an access token, or returns undefined for any reason it is invalid. */
export async function verifyAccessToken(
  secret: Uint8Array,
  token: string,
): Promise<AccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      // Pinned. Without this, a token whose header says `none` or names an
      // asymmetric algorithm would be accepted on the wrong terms.
      algorithms: ['HS256'],
      issuer: 'mcpluginmanager',
      audience: 'mcpluginmanager-api',
    });
    if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string') return undefined;
    return payload as AccessClaims;
  } catch {
    return undefined;
  }
}

export interface MintedRefreshToken {
  readonly token: string;
  readonly hash: string;
}

/** Refresh tokens are random, not signed — nothing reads them but this service. */
export function mintRefreshToken(): MintedRefreshToken {
  const token = secretToken(32);
  return { token, hash: digest(token) };
}
