import { Router, type Request } from 'express';
import { z } from 'zod';
import { errors } from '../../errors.js';
import { createAccountSchema, emailSchema } from '../identity/validation.js';
import { requireSession, actorOf } from './middleware.js';
import { pathParam } from '../../http/params.js';
import { SCOPES } from './tokens.js';
import { assertMayAdminister } from '../identity/authorize.js';
import type { IdentityService } from '../identity/service.js';
import type { ApiTokenRecord } from './repository.js';
import type { AuthService, DeviceContext, IssuedSession } from './service.js';
import type { AuditService } from '../audit/index.js';

const REFRESH_COOKIE = 'mcpm_refresh';

const registerSchema = createAccountSchema.extend({
  // Length over composition rules: a 12-character passphrase beats an
  // 8-character one with a symbol, and composition rules mostly produce
  // Password1!.
  password: z.string().min(12).max(256),
  deviceLabel: z.string().max(64).optional(),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  deviceLabel: z.string().max(64).optional(),
});

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(64),
  scopes: z.array(z.enum(SCOPES)).min(1),
  ownerAccountId: z.string().optional(),
  expiresInDays: z.number().int().positive().max(3650).nullable().optional(),
});

function deviceOf(req: Request, label?: string): DeviceContext {
  return {
    deviceLabel: label ?? null,
    userAgent: req.get('user-agent') ?? null,
    ip: req.ip ?? null,
  };
}

/** A token record as the panel sees it. Never includes the secret. */
function publicToken(record: ApiTokenRecord): Record<string, unknown> {
  return {
    id: record.id,
    name: record.name,
    prefix: record.token_prefix,
    scopes: JSON.parse(record.scopes) as string[],
    created_at: record.created_at,
    ...(record.expires_at === null ? {} : { expires_at: record.expires_at }),
    ...(record.last_used_at === null ? {} : { last_used_at: record.last_used_at }),
  };
}

export function createAuthRouter(
  auth: AuthService,
  secureCookies: boolean,
  audit: AuditService,
  identity?: IdentityService,
): Router {
  const router = Router();

  /**
   * The refresh token goes in an HttpOnly cookie, never in the JSON body.
   *
   * Script on the panel's origin can read a JSON response; it cannot read this.
   * The access token *is* returned in the body, deliberately — it is short-lived
   * and the panel needs it in memory to set an Authorization header.
   */
  const issueTo = (res: Parameters<Parameters<Router['post']>[1]>[1], issued: IssuedSession) => {
    res.cookie(REFRESH_COOKIE, issued.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/api/v1/auth',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.json({
      access_token: issued.accessToken,
      expires_in: issued.expiresIn,
      token_type: 'Bearer',
    });
  };

  router.post('/auth/register', async (req, res) => {
    const body = registerSchema.parse(req.body);
    const issued = await auth.register(body, deviceOf(req, body.deviceLabel));
    res.status(201);
    issueTo(res, issued);
  });

  router.post('/auth/login', async (req, res) => {
    const body = loginSchema.parse(req.body);
    const issued = await auth.login(body.email, body.password, deviceOf(req, body.deviceLabel));
    issueTo(res, issued);
  });

  router.post('/auth/refresh', async (req, res) => {
    const cookies = req.headers.cookie ?? '';
    const match = new RegExp(`(?:^|; )${REFRESH_COOKIE}=([^;]+)`).exec(cookies);
    const token = match?.[1];
    if (token === undefined) {
      throw errors.unauthorized('no_refresh_token', 'No refresh token was presented.');
    }
    const issued = await auth.refresh(decodeURIComponent(token), deviceOf(req));
    issueTo(res, issued);
  });

  router.post('/auth/logout', requireSession, async (req, res) => {
    const actor = actorOf(req);
    if (actor.kind === 'session') await auth.logout(actor.sessionId);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    res.status(204).end();
  });

  router.get('/me/sessions', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const sessions = await auth.listSessions(actor.accountId);
    res.json({
      data: sessions.map((s) => ({
        id: s.id,
        created_at: s.created_at,
        last_used_at: s.last_used_at,
        expires_at: s.expires_at,
        current: actor.kind === 'session' && actor.sessionId === s.id,
        ...(s.device_label === null ? {} : { device_label: s.device_label }),
        ...(s.user_agent === null ? {} : { user_agent: s.user_agent }),
        ...(s.ip_last_seen === null ? {} : { ip_last_seen: s.ip_last_seen }),
      })),
    });
  });

  router.delete('/me/sessions/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    await auth.revokeSession(actor.accountId, pathParam(req, 'id'));
    res.status(204).end();
  });

  router.get('/tokens', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const tokens = await auth.listApiTokens(actor.accountId);
    res.json({ data: tokens.map(publicToken) });
  });

  /**
   * The only response in the service that contains a token.
   *
   * There is no route that returns it again, because the service does not have
   * it — only the digest is stored.
   */
  router.post('/tokens', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const body = createTokenSchema.parse(req.body);

    /*
     * Who the token may belong to.
     *
     * This used to take `ownerAccountId` from the body and write it. Account
     * ids are public -- `GET /accounts/:handle` needs no credential and returns
     * one -- so anybody signed in could mint a token owned by somebody else's
     * account, and `authenticate()` returns that owner as the actor: the token
     * *was* that person, with their memberships and their right to publish.
     *
     * Same rule as every other "may I act for this account" question, and the
     * same function. With no identity service wired the answer is no, which is
     * the safe direction for a partially assembled app.
     */
    const ownerAccountId = body.ownerAccountId ?? actor.accountId;
    if (ownerAccountId !== actor.accountId) {
      if (identity === undefined) {
        throw errors.notFound('account_not_found', 'No such account.');
      }
      const owner = await identity.requireAccount(ownerAccountId);
      await assertMayAdminister(identity, owner, actor.accountId);
    }

    const { token, record } = await auth.createApiToken({
      ownerAccountId,
      createdBy: actor.accountId,
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays ?? null,
    });

    await audit.record({
      actor,
      subjectType: 'token',
      subjectId: record.id,
      action: 'token.created',
      metadata: { name: record.name, scopes: body.scopes },
      ip: req.ip,
    });

    res.status(201).json({ ...publicToken(record), token });
  });

  router.delete('/tokens/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const tokenId = pathParam(req, 'id');
    await auth.revokeApiToken(actor.accountId, tokenId);
    await audit.record({
      actor,
      subjectType: 'token',
      subjectId: tokenId,
      action: 'token.revoked',
      ip: req.ip,
    });
    res.status(204).end();
  });

  return router;
}
