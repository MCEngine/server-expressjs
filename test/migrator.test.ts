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
