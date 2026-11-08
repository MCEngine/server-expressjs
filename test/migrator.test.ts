import { describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { dialectTypes, migrateToLatest, migrations } from '../src/db/index.js';
import { freshDatabase } from './db-helpers.js';

describe('migrations', () => {
  it('creates every table the schema declares', async () => {
    const t = await freshDatabase();
    try {
      const rows = await sql<{ name: string }>`
        select name from sqlite_master where type = 'table' and name not like 'sqlite_%'
      `.execute(t.db);
      const names = rows.rows.map((r) => r.name);

      for (const table of [
        'accounts',
        'account_profiles',
        'account_emails',
        'org_members',
        'org_settings',
        'credentials',
        'identities',
        'sessions',
        'api_tokens',
        'products',
        'product_versions',
        'product_files',
        'minecraft_servers',
        'server_plugins',
        'audit_events',
        'fleet_events',
      ]) {
        expect(names).toContain(table);
      }
    } finally {
      await t.destroy();
    }
  });

  it('is idempotent, so startup can run it every boot', async () => {
    const t = await freshDatabase();
    try {
      // freshDatabase already migrated; a second run must apply nothing.
      const second = await migrateToLatest(t.db, dialectTypes('sqlite'));
      expect(second.applied).toEqual([]);
    } finally {
      await t.destroy();
    }
  });

  it('rolls back cleanly, so a bad deploy is reversible', async () => {
    const t = await freshDatabase();
    try {
      const migration = migrations(dialectTypes('sqlite'))['001-initial'];
      await migration!.down!(t.db);

      const rows = await sql<{ name: string }>`
        select name from sqlite_master where type = 'table' and name = 'accounts'
      `.execute(t.db);
      expect(rows.rows).toHaveLength(0);
    } finally {
      await t.destroy();
    }
  });

  it('builds a distinct dialect for each supported provider', () => {
    expect(dialectTypes('postgresql').timestamp).toBe('timestamptz');
    expect(dialectTypes('sqlite').timestamp).toBe('text');
    expect(dialectTypes('mysql').timestamp).toBe('datetime(3)');
    expect(dialectTypes('mariadb').timestamp).toBe('datetime(3)');

    // The partial-index split is the difference the migration branches on.
    expect(dialectTypes('postgresql').supportsPartialIndex).toBe(true);
    expect(dialectTypes('sqlite').supportsPartialIndex).toBe(true);
    expect(dialectTypes('mysql').supportsPartialIndex).toBe(false);
    expect(dialectTypes('mariadb').supportsPartialIndex).toBe(false);
  });
});

describe('009-mcstory-accounts', () => {
  it('moves player-keyed stories and achievements to player accounts', async () => {
    const t = await freshDatabase();
    try {
      const migration = migrations(dialectTypes('sqlite'))['009-mcstory-accounts']!;
      await migration.down!(t.db);

      await sql`insert into mcstory_stories (id, title, content, player_uuid, source, created_at)
        values ('s1', 'A', 'a', 'p1', 'minecraft', '2026-01-01T00:00:00.000Z'),
               ('s2', 'B', 'b', null, 'minecraft', '2026-01-02T00:00:00.000Z')`.execute(t.db);
      await sql`insert into mcstory_achievements (player_uuid, achievement_key, title, description, source, awarded_at)
        values ('p1', 'gatebreaker', 'G', 'g', 'minecraft', '2026-01-01T00:00:00.000Z')`.execute(t.db);

      await migration.up(t.db);

      const stories = await sql<{ id: string; account_type: string | null; account_uuid: string | null }>`
        select id, account_type, account_uuid from mcstory_stories order by id`.execute(t.db);
      expect(stories.rows).toEqual([
        { id: 's1', account_type: 'player', account_uuid: 'p1' },
        { id: 's2', account_type: null, account_uuid: null },
      ]);
      const awards = await sql<{ account_type: string; account_uuid: string; achievement_key: string }>`
        select account_type, account_uuid, achievement_key from mcstory_achievements`.execute(t.db);
      expect(awards.rows).toEqual([{ account_type: 'player', account_uuid: 'p1', achievement_key: 'gatebreaker' }]);
    } finally {
      await t.destroy();
    }
  });
});
