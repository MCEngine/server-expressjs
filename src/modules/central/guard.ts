import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { errors } from '../../errors.js';

/**
 * Admits a request whose bearer token is the deployment's `SERVER_API_TOKEN`.
 *
 * This is the only credential on the central plugin routes: a game server is
 * not a person and holds no session, and every plugin on a network carries
 * the same secret in its `central_server.token`. Both sides are hashed before
 * the comparison so the comparison is constant-time whatever the lengths are,
 * which `timingSafeEqual` alone refuses to be.
 */
export function requireServerToken(secret: string): RequestHandler {
  const expected = digest(secret);
  return (req, _res, next) => {
    const header = req.get('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match === null || !timingSafeEqual(digest(match[1]!.trim()), expected)) {
      next(errors.unauthorized('invalid_server_token', 'A valid central server token is required.'));
      return;
    }
    next();
  };
}

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
