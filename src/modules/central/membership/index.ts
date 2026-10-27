import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../db/schema.js';
import { errors } from '../../../errors.js';
import { iso, type Clock } from '../../../lib/clock.js';

export interface Membership {
  account_type: string;
  account_uuid: string;
  type: string;
  ended_time: string | null;
  updated_at: string;
}

interface Key {
  accountType: string;
  accountUuid: string;
}

/** Every query behind MCMembership's central backend. */
export interface CentralMembershipRepository {
  save(key: Key, type: string, endedAt: string | null, at: string): Promise<Membership>;
  find(key: Key, type: string): Promise<Membership | undefined>;
  list(key: Key): Promise<Membership[]>;
  /** Moves a membership to the archive; false when there was none. */
  archive(key: Key, type: string, at: string): Promise<boolean>;
}

export function createCentralMembershipRepository(db: Kysely<Database>): CentralMembershipRepository {
  const select = (trx: Kysely<Database>, key: Key) =>
    trx
      .selectFrom('mcmembership_memberships')
      .selectAll()
      .where('account_type', '=', key.accountType)
      .where('account_uuid', '=', key.accountUuid);

  // The plugin calls the end time `ended_time`; the column is `ended_at` so the
  // row normalizer turns it into ISO-8601 like every other timestamp.
  const out = (row: { account_type: string; account_uuid: string; type: string; ended_at: string | null; updated_at: string }): Membership => ({
    account_type: row.account_type,
    account_uuid: row.account_uuid,
    type: row.type,
    ended_time: row.ended_at,
    updated_at: row.updated_at,
  });

  return {
    save: (key, type, endedAt, at) =>
      db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('mcmembership_memberships')
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .where('type', '=', type)
          .execute();
        const row = { account_type: key.accountType, account_uuid: key.accountUuid, type, ended_at: endedAt, updated_at: at };
        await trx.insertInto('mcmembership_memberships').values(row).execute();
        return out(row);
      }),

    async find(key, type) {
      const row = await select(db, key).where('type', '=', type).executeTakeFirst();
      return row === undefined ? undefined : out(row);
    },

    async list(key) {
      return (await select(db, key).orderBy('type').execute()).map(out);
    },

    archive: (key, type, at) =>
      db.transaction().execute(async (trx) => {
        const row = await select(trx, key).where('type', '=', type).executeTakeFirst();
        if (row === undefined) return false;
        await trx
          .insertInto('mcmembership_archived')
          .values({ account_type: row.account_type, account_uuid: row.account_uuid, type, ended_at: row.ended_at, archived_at: at })
          .execute();
        await trx
          .deleteFrom('mcmembership_memberships')
          .where('account_type', '=', key.accountType)
          .where('account_uuid', '=', key.accountUuid)
          .where('type', '=', type)
          .execute();
        return true;
      }),
  };
}

const key = {
  account_type: z.string().trim().min(1).max(100),
  account_uuid: z.string().trim().min(1).max(64),
};
const type = z.string().trim().min(1).max(150);
const keyOf = (b: { account_type: string; account_uuid: string }): Key => ({
  accountType: b.account_type,
  accountUuid: b.account_uuid,
});

/**
 * MCMembership's central backend, under `/api/mcmembership`.
 */
export function createCentralMembershipRouter(repo: CentralMembershipRepository, clock: Clock): Router {
  const router = Router();
  const now = () => iso(clock.now());

  router.put('/memberships', async (req, res) => {
    const body = z
      .object({ ...key, type, ended_time: z.string().datetime({ offset: true }).nullable() })
      .parse(req.body);
    const endedAt = body.ended_time === null ? null : new Date(body.ended_time).toISOString();
    res.json({ membership: await repo.save(keyOf(body), body.type, endedAt, now()) });
  });

  router.get('/memberships/find', async (req, res) => {
    const query = z.object({ ...key, type }).parse(req.query);
    const membership = await repo.find(keyOf(query), query.type);
    if (membership === undefined) throw errors.notFound('membership_not_found', 'No such membership.');
    res.json({ membership });
  });

  router.get('/memberships', async (req, res) => {
    res.json({ memberships: await repo.list(keyOf(z.object(key).parse(req.query))) });
  });

  router.post('/memberships/archive', async (req, res) => {
    const body = z.object({ ...key, type }).parse(req.body);
    res.json({ archived: await repo.archive(keyOf(body), body.type, now()) });
  });

  return router;
}
