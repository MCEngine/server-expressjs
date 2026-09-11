import type { Kysely } from 'kysely';
import type { Database, IdentityProvider } from '../../db/schema.js';
import type { Scope } from './tokens.js';

export interface SessionRecord {
  id: string;
  account_id: string;
  device_label: string | null;
  user_agent: string | null;
  ip_last_seen: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface ApiTokenRecord {
  id: string;
  owner_account_id: string;
  /** The account that minted it — the only record of that once it is issued. */
  created_by: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AuthRepository {
  findPasswordHash(accountId: string): Promise<string | undefined>;
  upsertPassword(accountId: string, hash: string, at: string): Promise<void>;
  findAccountIdByEmail(email: string): Promise<string | undefined>;

  findIdentity(provider: IdentityProvider, providerUserId: string): Promise<string | undefined>;
  listIdentities(accountId: string): Promise<{ id: string; provider: string }[]>;
  insertIdentity(input: {
    id: string;
    accountId: string;
    provider: IdentityProvider;
    providerUserId: string;
    at: string;
  }): Promise<void>;
  deleteIdentity(id: string): Promise<void>;
  findIdentityById(id: string): Promise<{ id: string; account_id: string } | undefined>;

  insertSession(input: {
    id: string;
    accountId: string;
    refreshTokenHash: string;
    deviceLabel: string | null;
    userAgent: string | null;
    ip: string | null;
    at: string;
    expiresAt: string;
  }): Promise<void>;
  findSessionByRefreshHash(hash: string): Promise<(SessionRecord & { refresh_token_hash: string }) | undefined>;
  findSession(id: string): Promise<SessionRecord | undefined>;
  listSessions(accountId: string): Promise<SessionRecord[]>;
  rotateSession(id: string, nextHash: string, at: string, expiresAt: string): Promise<void>;
  revokeSession(id: string, at: string): Promise<void>;
  revokeAllSessions(accountId: string, at: string): Promise<void>;

  insertApiToken(input: {
    id: string;
    ownerAccountId: string;
    name: string;
    prefix: string;
    hash: string;
    scopes: readonly Scope[];
    expiresAt: string | null;
    createdBy: string;
    at: string;
  }): Promise<void>;
  findApiTokensByPrefix(prefix: string): Promise<ApiTokenRecord[]>;
  listApiTokens(ownerAccountId: string): Promise<ApiTokenRecord[]>;
  findApiToken(id: string): Promise<ApiTokenRecord | undefined>;
  touchApiToken(id: string, at: string): Promise<void>;
  revokeApiToken(id: string, at: string): Promise<void>;
}

const SESSION_COLUMNS = [
  'id',
  'account_id',
  'device_label',
  'user_agent',
  'ip_last_seen',
  'created_at',
  'last_used_at',
  'expires_at',
  'revoked_at',
] as const;

const TOKEN_COLUMNS = [
  'id',
  'owner_account_id',
  'created_by',
  'name',
  'token_prefix',
  'token_hash',
  'scopes',
  'expires_at',
  'last_used_at',
  'revoked_at',
  'created_at',
] as const;

export function createAuthRepository(db: Kysely<Database>): AuthRepository {
  return {
    async findPasswordHash(accountId) {
      const row = await db
        .selectFrom('credentials')
        .select('password_hash')
        .where('account_id', '=', accountId)
        .executeTakeFirst();
      return row?.password_hash;
    },

    async upsertPassword(accountId, hash, at) {
      // No `onConflict`: the two dialects spell it differently enough that a
      // delete-then-insert inside one transaction is clearer and portable.
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('credentials').where('account_id', '=', accountId).execute();
        await trx
          .insertInto('credentials')
          .values({ account_id: accountId, password_hash: hash, password_updated_at: at })
          .execute();
      });
    },

    async findAccountIdByEmail(email) {
      const row = await db
        .selectFrom('account_emails')
        .select('account_id')
        .where('email', '=', email)
        .executeTakeFirst();
      return row?.account_id;
    },

    async findIdentity(provider, providerUserId) {
      const row = await db
        .selectFrom('identities')
        .select('account_id')
        .where('provider', '=', provider)
        .where('provider_user_id', '=', providerUserId)
        .executeTakeFirst();
      return row?.account_id;
    },

    async listIdentities(accountId) {
      return db
        .selectFrom('identities')
        .select(['id', 'provider'])
        .where('account_id', '=', accountId)
        .execute();
    },

    async insertIdentity({ id, accountId, provider, providerUserId, at }) {
      await db
        .insertInto('identities')
        .values({
          id,
          account_id: accountId,
          provider,
          provider_user_id: providerUserId,
          created_at: at,
        })
        .execute();
    },

    async deleteIdentity(id) {
      await db.deleteFrom('identities').where('id', '=', id).execute();
    },

    async findIdentityById(id) {
      return db
        .selectFrom('identities')
        .select(['id', 'account_id'])
        .where('id', '=', id)
        .executeTakeFirst();
    },

    async insertSession({ id, accountId, refreshTokenHash, deviceLabel, userAgent, ip, at, expiresAt }) {
      await db
        .insertInto('sessions')
        .values({
          id,
          account_id: accountId,
          refresh_token_hash: refreshTokenHash,
          device_label: deviceLabel,
          user_agent: userAgent,
          ip_last_seen: ip,
          created_at: at,
          last_used_at: at,
          expires_at: expiresAt,
          revoked_at: null,
        })
        .execute();
    },

    async findSessionByRefreshHash(hash) {
      return db
        .selectFrom('sessions')
        .select([...SESSION_COLUMNS, 'refresh_token_hash'])
        .where('refresh_token_hash', '=', hash)
        .executeTakeFirst();
    },

    async findSession(id) {
      return db.selectFrom('sessions').select(SESSION_COLUMNS).where('id', '=', id).executeTakeFirst();
    },

    async listSessions(accountId) {
      return db
        .selectFrom('sessions')
        .select(SESSION_COLUMNS)
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .orderBy('last_used_at', 'desc')
        .execute();
    },

    async rotateSession(id, nextHash, at, expiresAt) {
      await db
        .updateTable('sessions')
        .set({ refresh_token_hash: nextHash, last_used_at: at, expires_at: expiresAt })
        .where('id', '=', id)
        .execute();
    },

    async revokeSession(id, at) {
      await db.updateTable('sessions').set({ revoked_at: at }).where('id', '=', id).execute();
    },

    async revokeAllSessions(accountId, at) {
      await db
        .updateTable('sessions')
        .set({ revoked_at: at })
        .where('account_id', '=', accountId)
        .where('revoked_at', 'is', null)
        .execute();
    },

    async insertApiToken({ id, ownerAccountId, name, prefix, hash, scopes, expiresAt, createdBy, at }) {
      await db
        .insertInto('api_tokens')
        .values({
          id,
          owner_account_id: ownerAccountId,
          name,
          token_prefix: prefix,
          token_hash: hash,
          scopes: JSON.stringify(scopes),
          expires_at: expiresAt,
          last_used_at: null,
          revoked_at: null,
          created_by: createdBy,
          created_at: at,
        })
        .execute();
    },

    async findApiTokensByPrefix(prefix) {
      return db
        .selectFrom('api_tokens')
        .select(TOKEN_COLUMNS)
        .where('token_prefix', '=', prefix)
        .execute();
    },

    async listApiTokens(ownerAccountId) {
      return db
        .selectFrom('api_tokens')
        .select(TOKEN_COLUMNS)
        .where('owner_account_id', '=', ownerAccountId)
        .where('revoked_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
    },

    async findApiToken(id) {
      return db.selectFrom('api_tokens').select(TOKEN_COLUMNS).where('id', '=', id).executeTakeFirst();
    },

    async touchApiToken(id, at) {
      await db.updateTable('api_tokens').set({ last_used_at: at }).where('id', '=', id).execute();
    },

    async revokeApiToken(id, at) {
      await db.updateTable('api_tokens').set({ revoked_at: at }).where('id', '=', id).execute();
    },
  };
}
