import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, dialectTypes, migrateToLatest, type DatabaseHandle } from '../src/db/index.js';
import { ulid } from '../src/lib/ids.js';
import { loadConfig } from '../src/config.js';

export interface TestDatabase extends DatabaseHandle {
  destroy(): Promise<void>;
}

/**
 * A migrated SQLite database in a fresh temporary directory, per caller.
 *
 * On disk rather than `:memory:` deliberately: WAL and `PRAGMA foreign_keys` are
 * what the production configuration uses, and an in-memory database behaves
 * differently enough on both that a constraint could pass here and fail there.
 */
export async function freshDatabase(): Promise<TestDatabase> {
  const dir = mkdtempSync(join(tmpdir(), 'mcpm-test-'));
  const file = join(dir, 'test.sqlite');

  const config = loadConfig({
    NODE_ENV: 'test',
    JWT_SECRET: 'a'.repeat(32),
    LOG_LEVEL: 'silent',
    DATABASE_PROVIDER: 'sqlite',
    DATABASE_URL: `file:${file}`,
  });

  const handle = await createDatabase(config);
  await migrateToLatest(handle.db, dialectTypes('sqlite'));

  return {
    ...handle,
    async destroy() {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const now = () => new Date().toISOString();

/** Inserts an account and its profile, and returns the id. */
export async function seedAccount(
  handle: DatabaseHandle,
  type: 'user' | 'org',
  handleName: string,
): Promise<string> {
  const id = ulid();
  await handle.db
    .insertInto('accounts')
    .values({ id, type, status: 'active', created_at: now(), updated_at: now() })
    .execute();
  await handle.db
    .insertInto('account_profiles')
    .values({
      account_id: id,
      handle: handleName,
      display_name: handleName,
      handle_changed_at: null,
      avatar_url: null,
      bio: null,
      created_at: now(),
      updated_at: now(),
    })
    .execute();
  return id;
}

export async function seedProduct(
  handle: DatabaseHandle,
  orgId: string,
  slug: string,
): Promise<string> {
  const id = ulid();
  await handle.db
    .insertInto('products')
    .values({
      id,
      slug,
      owner_org_id: orgId,
      name: slug,
      summary: 'A product.',
      description: null,
      kind: 'bukkit_plugin',
      repo_url: null,
      homepage_url: null,
      license: null,
      visibility: 'public',
      slug_changed_at: null,
      created_at: now(),
      updated_at: now(),
      deleted_at: null,
    })
    .execute();
  return id;
}

export async function seedVersion(
  handle: DatabaseHandle,
  productId: string,
  version: string,
  versionNorm: string,
): Promise<string> {
  const id = ulid();
  await handle.db
    .insertInto('product_versions')
    .values({
      id,
      product_id: productId,
      version,
      version_norm: versionNorm,
      channel: 'release',
      changelog: null,
      is_latest: false,
      published_at: now(),
      created_at: now(),
    })
    .execute();
  return id;
}

export const timestamp = now;
