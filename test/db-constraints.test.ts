import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  freshDatabase,
  seedAccount,
  seedProduct,
  seedVersion,
  timestamp,
  type TestDatabase,
} from './db-helpers.js';
import { ulid } from '../src/lib/ids.js';
import { normalizeVersion } from '../src/lib/version.js';

/**
 * One test per row of the "What the schema enforces on its own" table in
 * `wiki/information/data-model.md`.
 *
 * These are the rules the documentation claims the database carries rather than
 * a handler. If any of them can be violated by a direct insert, the claim is
 * false and the rule lives only in code that a later refactor can route around.
 */
describe('constraints the schema carries itself', () => {
  let t: TestDatabase;

  beforeAll(async () => {
    t = await freshDatabase();
  });

  afterAll(async () => {
    await t.destroy();
  });

  it('refuses a duplicate handle', async () => {
    await seedAccount(t, 'user', 'alice');
    await expect(seedAccount(t, 'user', 'alice')).rejects.toThrow();
  });

  it('refuses a handle that is not lowercase', async () => {
    await expect(seedAccount(t, 'user', 'Bob')).rejects.toThrow();
  });

  it('refuses an account type it has no meaning for', async () => {
    await expect(
      t.db
        .insertInto('accounts')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({ id: ulid(), type: 'robot' as any, status: 'active', created_at: timestamp(), updated_at: timestamp() })
        .execute(),
    ).rejects.toThrow();
  });

  it('binds one email address to one account', async () => {
    const one = await seedAccount(t, 'user', 'carol');
    const two = await seedAccount(t, 'user', 'dave');
    const values = (accountId: string) => ({
      id: ulid(),
      account_id: accountId,
      email: 'shared@example.com',
      is_primary: false,
      verified_at: null,
      created_at: timestamp(),
      updated_at: timestamp(),
    });

    await t.db.insertInto('account_emails').values(values(one)).execute();
    await expect(t.db.insertInto('account_emails').values(values(two)).execute()).rejects.toThrow();
  });

  it('allows an account many emails but only one primary', async () => {
    const account = await seedAccount(t, 'user', 'erin');
    const email = (address: string, primary: boolean) => ({
      id: ulid(),
      account_id: account,
      email: address,
      is_primary: primary,
      verified_at: timestamp(),
      created_at: timestamp(),
      updated_at: timestamp(),
    });

    await t.db.insertInto('account_emails').values(email('erin-a@example.com', true)).execute();
    await t.db.insertInto('account_emails').values(email('erin-b@example.com', false)).execute();
    await t.db.insertInto('account_emails').values(email('erin-c@example.com', false)).execute();

    await expect(
      t.db.insertInto('account_emails').values(email('erin-d@example.com', true)).execute(),
    ).rejects.toThrow();
  });

  it('allows an org exactly one owner and any number of other roles', async () => {
    const org = await seedAccount(t, 'org', 'acme');
    const users = await Promise.all(
      ['u1', 'u2', 'u3'].map((n) => seedAccount(t, 'user', `acme-${n}`)),
    );
    const member = (userId: string, role: 'owner' | 'admin' | 'member') => ({
      org_id: org,
      user_id: userId,
      role,
      invited_by: null,
      created_at: timestamp(),
      updated_at: timestamp(),
    });

    await t.db.insertInto('org_members').values(member(users[0]!, 'owner')).execute();
    await t.db.insertInto('org_members').values(member(users[1]!, 'admin')).execute();

    await expect(
      t.db.insertInto('org_members').values(member(users[2]!, 'owner')).execute(),
    ).rejects.toThrow();
  });

  it('refuses the same user twice in one org', async () => {
    const org = await seedAccount(t, 'org', 'globex');
    const user = await seedAccount(t, 'user', 'globex-u1');
    const row = {
      org_id: org,
      user_id: user,
      role: 'member' as const,
      invited_by: null,
      created_at: timestamp(),
      updated_at: timestamp(),
    };

    await t.db.insertInto('org_members').values(row).execute();
    await expect(t.db.insertInto('org_members').values(row).execute()).rejects.toThrow();
  });

  it('refuses a product version number used twice for one product', async () => {
    const org = await seedAccount(t, 'org', 'initech');
    const product = await seedProduct(t, org, 'initech-tool');

    await seedVersion(t, product, '1.0.0', normalizeVersion('1.0.0'));
    await expect(seedVersion(t, product, '1.0.0', normalizeVersion('1.0.0'))).rejects.toThrow();
  });

  it('allows the same version number across different products', async () => {
    const org = await seedAccount(t, 'org', 'umbrella');
    const a = await seedProduct(t, org, 'umbrella-a');
    const b = await seedProduct(t, org, 'umbrella-b');

    await seedVersion(t, a, '2.0.0', normalizeVersion('2.0.0'));
    await expect(seedVersion(t, b, '2.0.0', normalizeVersion('2.0.0'))).resolves.toBeTruthy();
  });

  it('allows one latest version per channel and no more', async () => {
    const org = await seedAccount(t, 'org', 'cyberdyne');
    const product = await seedProduct(t, org, 'cyberdyne-core');
    const latest = (version: string, channel: 'release' | 'beta') => ({
      id: ulid(),
      product_id: product,
      version,
      version_norm: normalizeVersion(version),
      channel,
      changelog: null,
      is_latest: true,
      published_at: timestamp(),
      created_at: timestamp(),
    });

    await t.db.insertInto('product_versions').values(latest('1.0.0', 'release')).execute();
    // A different channel is a different latest, and that is allowed.
    await t.db.insertInto('product_versions').values(latest('1.1.0-beta', 'beta')).execute();

    await expect(
      t.db.insertInto('product_versions').values(latest('1.0.1', 'release')).execute(),
    ).rejects.toThrow();
  });

  it('carries at most one jar per version, which is the one-jar rule', async () => {
    const org = await seedAccount(t, 'org', 'tyrell');
    const product = await seedProduct(t, org, 'tyrell-plugin');
    const version = await seedVersion(t, product, '1.0.0', normalizeVersion('1.0.0'));
    const file = (name: string) => ({
      version_id: version,
      file_name: name,
      storage_key: ulid(),
      size_bytes: 1024,
      sha256: 'a'.repeat(64),
      content_type: 'application/java-archive',
      uploaded_by: null,
      upload_source: 'web' as const,
      created_at: timestamp(),
    });

    await t.db.insertInto('product_files').values(file('one.jar')).execute();
    await expect(t.db.insertInto('product_files').values(file('two.jar')).execute()).rejects.toThrow();
  });

  it('refuses a stored file name that is a path', async () => {
    const org = await seedAccount(t, 'org', 'weyland');
    const product = await seedProduct(t, org, 'weyland-plugin');
    const version = await seedVersion(t, product, '1.0.0', normalizeVersion('1.0.0'));

    await expect(
      t.db
        .insertInto('product_files')
        .values({
          version_id: version,
          file_name: '../../etc/cron.d/payload',
          storage_key: ulid(),
          size_bytes: 1024,
          sha256: 'a'.repeat(64),
          content_type: 'application/java-archive',
          uploaded_by: null,
          upload_source: 'ci',
          created_at: timestamp(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('refuses a zero-byte file, which is never a valid jar', async () => {
    const org = await seedAccount(t, 'org', 'soylent');
    const product = await seedProduct(t, org, 'soylent-plugin');
    const version = await seedVersion(t, product, '1.0.0', normalizeVersion('1.0.0'));

    await expect(
      t.db
        .insertInto('product_files')
        .values({
          version_id: version,
          file_name: 'empty.jar',
          storage_key: ulid(),
          size_bytes: 0,
          sha256: 'a'.repeat(64),
          content_type: 'application/java-archive',
          uploaded_by: null,
          upload_source: 'web',
          created_at: timestamp(),
        })
        .execute(),
    ).rejects.toThrow();
  });

  it('allows one plugin id per server and repeats it across servers', async () => {
    const owner = await seedAccount(t, 'user', 'operator');
    const servers = await Promise.all(
      ['alpha', 'beta'].map(async (name) => {
        const id = ulid();
        await t.db
          .insertInto('minecraft_servers')
          .values({
            id,
            owner_account_id: owner,
            server_key: ulid(),
            server_url: null,
            name,
            platform: 'paper',
            mc_version: '1.21.11',
            agent_version: '0.0.0',
            last_seen_at: null,
            created_at: timestamp(),
            updated_at: timestamp(),
          })
          .execute();
        return id;
      }),
    );

    const installed = (serverId: string) => ({
      server_id: serverId,
      plugin_id: 'Essentials',
      product_id: null,
      installed_version: '2.19.0',
      installed_sha256: null,
      desired_version: null,
      state: 'installed' as const,
      last_error: null,
      created_at: timestamp(),
      updated_at: timestamp(),
    });

    await t.db.insertInto('server_plugins').values(installed(servers[0]!)).execute();
    // The same plugin on a different server: this is the case that must work.
    await t.db.insertInto('server_plugins').values(installed(servers[1]!)).execute();
    // The same plugin twice on one server: this is the case that must not.
    await expect(
      t.db.insertInto('server_plugins').values(installed(servers[0]!)).execute(),
    ).rejects.toThrow();
  });

  it('enforces foreign keys, which SQLite does not do by default', async () => {
    await expect(
      seedProduct(t, ulid(), 'orphan-product'),
    ).rejects.toThrow();
  });

  it('refuses a negative storage usage', async () => {
    const org = await seedAccount(t, 'org', 'quota-org');
    await expect(
      t.db
        .insertInto('org_settings')
        .values({
          org_id: org,
          membership_tier: 'free',
          storage_quota_bytes: 1000,
          storage_used_bytes: -1,
          max_file_bytes: 100,
          created_at: timestamp(),
          updated_at: timestamp(),
        })
        .execute(),
    ).rejects.toThrow();
  });
});
