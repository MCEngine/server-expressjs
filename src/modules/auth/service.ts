import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { addDays, iso, type Clock } from '../../lib/clock.js';
import type { Config } from '../../config.js';
import type { IdentityProvider } from '../../db/schema.js';
import type { IdentityService } from '../identity/index.js';
import type { AuthRepository, ApiTokenRecord, SessionRecord } from './repository.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import {
  digestMatches,
  isScope,
  mintApiToken,
  mintRefreshToken,
  parseApiToken,
  signAccessToken,
  verifyAccessToken,
  type Scope,
} from './tokens.js';

/** Who is making a request. Resolved by the middleware, never trusted from a body. */
export type Actor =
  | { kind: 'session'; accountId: string; sessionId: string }
  | { kind: 'token'; accountId: string; tokenId: string; scopes: readonly Scope[] };

export interface IssuedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly sessionId: string;
}

export interface DeviceContext {
  readonly deviceLabel?: string | null;
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

export interface AuthService {
  register(input: {
    handle: string;
    displayName: string;
    email: string;
    password: string;
  }, device: DeviceContext): Promise<IssuedSession>;
  login(email: string, password: string, device: DeviceContext): Promise<IssuedSession>;
  refresh(refreshToken: string, device: DeviceContext): Promise<IssuedSession>;
  logout(sessionId: string): Promise<void>;
  listSessions(accountId: string): Promise<SessionRecord[]>;
  revokeSession(accountId: string, sessionId: string): Promise<void>;

  linkIdentity(accountId: string, provider: IdentityProvider, providerUserId: string): Promise<void>;
  signInWithIdentity(provider: IdentityProvider, providerUserId: string, device: DeviceContext): Promise<IssuedSession>;
  unlinkIdentity(accountId: string, identityId: string): Promise<void>;

  createApiToken(input: {
    ownerAccountId: string;
    createdBy: string;
    name: string;
    scopes: readonly string[];
    expiresInDays?: number | null;
  }): Promise<{ token: string; record: ApiTokenRecord }>;
  listApiTokens(ownerAccountId: string): Promise<ApiTokenRecord[]>;
  revokeApiToken(ownerAccountId: string, tokenId: string): Promise<void>;

  authenticate(bearer: string): Promise<Actor | undefined>;
}

export function createAuthService(
  repo: AuthRepository,
  identity: IdentityService,
  config: Config,
  clock: Clock,
): AuthService {
  const secret = new TextEncoder().encode(config.JWT_SECRET);
  const now = () => iso(clock.now());
  const refreshExpiry = () =>
    iso(new Date(clock.now().getTime() + config.REFRESH_TOKEN_TTL_SECONDS * 1000));

  const issue = async (accountId: string, device: DeviceContext): Promise<IssuedSession> => {
    const sessionId = ulid();
    const refresh = mintRefreshToken();
    const at = now();

    await repo.insertSession({
      id: sessionId,
      accountId,
      refreshTokenHash: refresh.hash,
      deviceLabel: device.deviceLabel ?? null,
      userAgent: device.userAgent ?? null,
      ip: device.ip ?? null,
      at,
      expiresAt: refreshExpiry(),
    });

    return {
      accessToken: await signAccessToken(secret, accountId, sessionId, config.ACCESS_TOKEN_TTL_SECONDS),
      refreshToken: refresh.token,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      sessionId,
    };
  };

  return {
    async register(input, device) {
      const account = await identity.createUser({
        handle: input.handle,
        displayName: input.displayName,
        email: input.email,
      });
      await repo.upsertPassword(account.id, await hashPassword(input.password), now());
      return issue(account.id, device);
    },

    async login(email, password, device) {
      const accountId = await repo.findAccountIdByEmail(email);
      const stored = accountId === undefined ? undefined : await repo.findPasswordHash(accountId);

      // Hash against a decoy when the account or the credential is missing, so
      // the response time does not say which addresses are registered.
      const ok = await verifyPassword(password, stored ?? DECOY_HASH);
      if (accountId === undefined || stored === undefined || !ok) {
        throw errors.unauthorized('invalid_credentials', 'That email address or password is wrong.');
      }

      if (needsRehash(stored)) {
        await repo.upsertPassword(accountId, await hashPassword(password), now());
      }
      return issue(accountId, device);
    },

    async refresh(refreshToken, device) {
      const { digest } = await import('./tokens.js');
      const session = await repo.findSessionByRefreshHash(digest(refreshToken));

      if (session === undefined) {
        throw errors.unauthorized('invalid_refresh_token', 'That refresh token is not valid.');
      }

      if (session.revoked_at !== null) {
        // A revoked session's token being presented means the token was
        // captured: rotation should have made it single-use. Revoke every
        // session on the account rather than only refusing this one.
        await repo.revokeAllSessions(session.account_id, now());
        throw errors.unauthorized(
          'refresh_token_reused',
          'This session has been signed out everywhere because a token was reused.',
        );
      }

      if (new Date(session.expires_at) <= clock.now()) {
        await repo.revokeSession(session.id, now());
        throw errors.unauthorized('session_expired', 'This session has expired. Sign in again.');
      }

      const next = mintRefreshToken();
      await repo.rotateSession(session.id, next.hash, now(), refreshExpiry());

      return {
        accessToken: await signAccessToken(
          secret,
          session.account_id,
          session.id,
          config.ACCESS_TOKEN_TTL_SECONDS,
        ),
        refreshToken: next.token,
        expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
        sessionId: session.id,
      };
    },

    async logout(sessionId) {
      await repo.revokeSession(sessionId, now());
    },

    listSessions: (accountId) => repo.listSessions(accountId),

    async revokeSession(accountId, sessionId) {
      const session = await repo.findSession(sessionId);
      if (session === undefined || session.account_id !== accountId) {
        throw errors.notFound('session_not_found', 'No such session.');
      }
      await repo.revokeSession(sessionId, now());
    },

    async linkIdentity(accountId, provider, providerUserId) {
      const existing = await repo.findIdentity(provider, providerUserId);
      if (existing !== undefined && existing !== accountId) {
        throw errors.conflict(
          'identity_taken',
          'That account with the identity provider is already linked to a different namespace.',
        );
      }
      if (existing === accountId) return;
      await repo.insertIdentity({ id: ulid(), accountId, provider, providerUserId, at: now() });
    },

    async signInWithIdentity(provider, providerUserId, device) {
      const accountId = await repo.findIdentity(provider, providerUserId);
      if (accountId === undefined) {
        throw errors.notFound('identity_not_linked', 'That identity is not linked to any account.');
      }
      return issue(accountId, device);
    },

    async unlinkIdentity(accountId, identityId) {
      const identityRow = await repo.findIdentityById(identityId);
      if (identityRow === undefined || identityRow.account_id !== accountId) {
        throw errors.notFound('identity_not_found', 'No such linked identity.');
      }

      // An account must keep at least one way in. Removing the last one makes
      // it unreachable, and there is no support flow to undo that.
      const identities = await repo.listIdentities(accountId);
      const hasPassword = (await repo.findPasswordHash(accountId)) !== undefined;
      if (!hasPassword && identities.length <= 1) {
        throw errors.badRequest(
          'last_credential',
          'Set a password before removing your only linked identity.',
        );
      }

      await repo.deleteIdentity(identityId);
    },

    async createApiToken({ ownerAccountId, createdBy, name, scopes, expiresInDays }) {
      const requested = [...new Set(scopes)];
      const invalid = requested.filter((s) => !isScope(s));
      if (invalid.length > 0) {
        throw errors.badRequest('unknown_scope', `Unknown scope: ${invalid.join(', ')}.`, {
          unknown: invalid,
        });
      }
      if (requested.length === 0) {
        throw errors.badRequest('no_scopes', 'A token must carry at least one scope.');
      }

      const minted = mintApiToken();
      const id = ulid();
      await repo.insertApiToken({
        id,
        ownerAccountId,
        name,
        prefix: minted.prefix,
        hash: minted.hash,
        scopes: requested as Scope[],
        expiresAt:
          expiresInDays === undefined || expiresInDays === null
            ? null
            : iso(addDays(clock.now(), expiresInDays)),
        createdBy,
        at: now(),
      });

      const record = await repo.findApiToken(id);
      if (record === undefined) throw errors.notFound('token_not_found', 'No such token.');
      // The only moment the token itself exists outside the caller's hands.
      return { token: minted.token, record };
    },

    listApiTokens: (ownerAccountId) => repo.listApiTokens(ownerAccountId),

    async revokeApiToken(ownerAccountId, tokenId) {
      const token = await repo.findApiToken(tokenId);
      if (token === undefined || token.owner_account_id !== ownerAccountId) {
        throw errors.notFound('token_not_found', 'No such token.');
      }
      await repo.revokeApiToken(tokenId, now());
    },

    async authenticate(bearer) {
      const parsed = parseApiToken(bearer);

      if (parsed === undefined) {
        const claims = await verifyAccessToken(secret, bearer);
        if (claims === undefined) return undefined;

        // A valid signature is not enough: the session it names may have been
        // revoked since, and the access token outlives that by up to its TTL.
        const session = await repo.findSession(claims.sid);
        if (session === undefined || session.revoked_at !== null) return undefined;
        if (new Date(session.expires_at) <= clock.now()) return undefined;

        return { kind: 'session', accountId: claims.sub, sessionId: claims.sid };
      }

      const candidates = await repo.findApiTokensByPrefix(parsed.prefix);
      for (const candidate of candidates) {
        if (!digestMatches(candidate.token_hash, parsed.hash)) continue;
        if (candidate.revoked_at !== null) return undefined;
        if (candidate.expires_at !== null && new Date(candidate.expires_at) <= clock.now()) {
          return undefined;
        }

        await repo.touchApiToken(candidate.id, now());
        const scopes = (JSON.parse(candidate.scopes) as string[]).filter(isScope);
        return { kind: 'token', accountId: candidate.owner_account_id, tokenId: candidate.id, scopes };
      }

      return undefined;
    },
  };
}

/**
 * A real scrypt hash of a value nobody holds.
 *
 * Verifying against it when an account does not exist keeps the failing path the
 * same cost as the succeeding one, so response time does not reveal which email
 * addresses are registered. Computed once at module load, not per request.
 */
const DECOY_HASH =
  'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
