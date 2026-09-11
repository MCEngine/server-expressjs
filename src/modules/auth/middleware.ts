import type { RequestHandler } from 'express';
import { errors } from '../../errors.js';
import type { Actor, AuthService } from './service.js';
import type { Scope } from './tokens.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `attachActor`. Undefined when the request carried no credential. */
      actor?: Actor;
    }
  }
}

/**
 * Resolves the bearer credential, if there is one, and attaches the actor.
 *
 * Deliberately does **not** reject an anonymous request: several routes are
 * public, and a few change what they return depending on who is asking. The
 * rejecting is `requireActor` and `requireScope`, mounted per route.
 */
export function attachActor(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization');
    if (header === undefined || !header.startsWith('Bearer ')) {
      next();
      return;
    }

    void auth
      .authenticate(header.slice('Bearer '.length).trim())
      .then((actor) => {
        if (actor !== undefined) req.actor = actor;
        next();
      })
      .catch(next);
  };
}

/** Requires any authenticated caller — a session or a token. */
export const requireActor: RequestHandler = (req, _res, next) => {
  if (req.actor === undefined) {
    next(errors.unauthorized());
    return;
  }
  next();
};

/**
 * Requires a signed-in person, not a machine credential.
 *
 * Administering an account, minting a token or deleting a product are things a
 * person does; letting an API token do them would mean a leaked CI credential
 * could mint itself a wider one.
 */
export const requireSession: RequestHandler = (req, _res, next) => {
  if (req.actor === undefined) {
    next(errors.unauthorized());
    return;
  }
  if (req.actor.kind !== 'session') {
    next(
      errors.forbidden(
        'session_required',
        'This action needs a signed-in user, not an API token.',
      ),
    );
    return;
  }
  next();
};

/**
 * Requires a specific scope.
 *
 * A session satisfies any scope: a person acting in their own browser is not
 * restricted by a token's grant. A token without the scope gets 403 rather than
 * 404 — it is authenticated, and hiding existence from it only makes the
 * failure harder to debug.
 */
export function requireScope(scope: Scope): RequestHandler {
  return (req, _res, next) => {
    const actor = req.actor;
    if (actor === undefined) {
      next(errors.unauthorized());
      return;
    }
    if (actor.kind === 'session') {
      next();
      return;
    }
    if (!actor.scopes.includes(scope)) {
      next(
        errors.forbidden('missing_scope', `This action needs the ${scope} scope.`, {
          required: scope,
          held: actor.scopes,
        }),
      );
      return;
    }
    next();
  };
}

/** The actor, or a thrown 401. For use inside a handler already behind a guard. */
export function actorOf(req: Express.Request): Actor {
  if (req.actor === undefined) throw errors.unauthorized();
  return req.actor;
}
