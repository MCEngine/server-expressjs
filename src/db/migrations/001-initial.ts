import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DialectTypes } from '../types.js';

/**
 * The initial schema, matching `wiki/information/data-model.md`.
 *
 * Written as one migration rather than one per table because there is no
 * intermediate state worth having: every foreign key here points at another
 * table in this same file, and splitting it would only create an ordering
 * problem that the split was supposed to avoid.
 */
export function migration001Initial(t: DialectTypes): Migration {
  return {
    async up(db: Kysely<unknown>): Promise<void> {
      await accounts(db, t);
      await authentication(db, t);
      await catalogue(db, t);
      await fleet(db, t);
      await logs(db, t);
      await conditionalUniques(db, t);
    },

    async down(db: Kysely<unknown>): Promise<void> {
      // Reverse creation order, so a foreign key never outlives its target.
      for (const table of [
        'fleet_events',
        'audit_events',
        'external_sources',
        'server_plugins',
        'minecraft_servers',
        'product_compatibility',
        'product_files',
        'product_versions',
        'product_slug_history',
        'products',
        'api_tokens',
        'verification_tokens',
        'sessions',
        'identities',
        'credentials',
        'org_settings',
        'org_members',
        'account_emails',
        'account_handle_history',
        'account_profiles',
        'accounts',
      ]) {
        await db.schema.dropTable(table).ifExists().execute();
      }
    },
  };
}

async function accounts(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  await db.schema
    .createTable('accounts')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('type', 'varchar(8)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('active'))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addCheckConstraint('accounts_type', sql`type in ('user', 'org')`)
    .execute();

  await db.schema
    .createTable('account_profiles')
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.primaryKey().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('handle', 'varchar(39)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(64)', (c) => c.notNull())
    .addColumn('handle_changed_at', sql.raw(t.timestamp))
    .addColumn('avatar_url', sql.raw(t.text))
    .addColumn('bio', sql.raw(t.text))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    // The unique index alone is not enough: SQLite and MySQL differ on whether
    // it is case-sensitive, so the constraint is what makes the behaviour the
    // same on all four rather than a property of the default collation.
    .addCheckConstraint('account_profiles_handle_lowercase', sql`handle = lower(handle)`)
    .execute();

  await db.schema
    .createTable('account_handle_history')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('account_id', sql.raw(t.id), (c) => c.notNull().references('accounts.id'))
    .addColumn('handle', 'varchar(39)', (c) => c.notNull())
    .addColumn('released_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('ix_handle_history_handle')
    .on('account_handle_history')
    .column('handle')
    .execute();

  await db.schema
    .createTable('account_emails')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('email', 'varchar(254)', (c) => c.notNull().unique())
    .addColumn('is_primary', sql.raw(t.boolean), (c) => c.notNull().defaultTo(0))
    .addColumn('verified_at', sql.raw(t.timestamp))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('org_members')
    .addColumn('org_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('user_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('role', 'varchar(16)', (c) => c.notNull())
    .addColumn('invited_by', sql.raw(t.id), (c) => c.references('accounts.id'))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_org_members', ['org_id', 'user_id'])
    .addCheckConstraint(
      'org_members_role',
      sql`role in ('owner', 'admin', 'maintainer', 'member')`,
    )
    .execute();

  await db.schema
    .createTable('org_settings')
    .addColumn('org_id', sql.raw(t.id), (c) =>
      c.primaryKey().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('membership_tier', 'varchar(16)', (c) => c.notNull().defaultTo('free'))
    .addColumn('storage_quota_bytes', sql.raw(t.bigint), (c) => c.notNull())
    .addColumn('storage_used_bytes', sql.raw(t.bigint), (c) => c.notNull().defaultTo(0))
    .addColumn('max_file_bytes', sql.raw(t.bigint), (c) => c.notNull())
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addCheckConstraint('org_settings_used_not_negative', sql`storage_used_bytes >= 0`)
    .execute();
}

async function authentication(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  await db.schema
    .createTable('credentials')
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.primaryKey().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('password_hash', sql.raw(t.text), (c) => c.notNull())
    .addColumn('password_updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('identities')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('provider', 'varchar(16)', (c) => c.notNull())
    .addColumn('provider_user_id', 'varchar(255)', (c) => c.notNull())
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addUniqueConstraint('uq_identity_provider_user', ['provider', 'provider_user_id'])
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('refresh_token_hash', 'char(64)', (c) => c.notNull().unique())
    .addColumn('device_label', 'varchar(64)')
    .addColumn('user_agent', sql.raw(t.text))
    .addColumn('ip_last_seen', 'varchar(45)')
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('last_used_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('revoked_at', sql.raw(t.timestamp))
    .execute();

  await db.schema
    .createIndex('ix_sessions_account')
    .on('sessions')
    .column('account_id')
    .execute();

  await db.schema
    .createTable('verification_tokens')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('purpose', 'varchar(24)', (c) => c.notNull())
    .addColumn('email', 'varchar(254)', (c) => c.notNull())
    .addColumn('token_hash', 'char(64)', (c) => c.notNull().unique())
    .addColumn('expires_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('consumed_at', sql.raw(t.timestamp))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addCheckConstraint(
      'verification_tokens_purpose',
      sql`purpose in ('email_verification', 'password_reset')`,
    )
    .execute();

  await db.schema
    .createTable('api_tokens')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('owner_account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(64)', (c) => c.notNull())
    .addColumn('token_prefix', 'char(8)', (c) => c.notNull())
    .addColumn('token_hash', 'char(64)', (c) => c.notNull().unique())
    .addColumn('scopes', sql.raw(t.text), (c) => c.notNull())
    .addColumn('expires_at', sql.raw(t.timestamp))
    .addColumn('last_used_at', sql.raw(t.timestamp))
    .addColumn('revoked_at', sql.raw(t.timestamp))
    .addColumn('created_by', sql.raw(t.id), (c) => c.notNull().references('accounts.id'))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  // Lookup is an indexed hit on eight non-secret characters, then one hash
  // comparison -- rather than hashing the candidate against every row.
  await db.schema
    .createIndex('ix_api_tokens_prefix')
    .on('api_tokens')
    .column('token_prefix')
    .execute();
}

async function catalogue(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  await db.schema
    .createTable('products')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('slug', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('owner_org_id', sql.raw(t.id), (c) => c.notNull().references('accounts.id'))
    .addColumn('name', 'varchar(128)', (c) => c.notNull())
    .addColumn('summary', 'varchar(256)', (c) => c.notNull())
    .addColumn('description', sql.raw(t.text))
    .addColumn('kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('repo_url', sql.raw(t.text))
    .addColumn('homepage_url', sql.raw(t.text))
    .addColumn('license', 'varchar(64)')
    .addColumn('visibility', 'varchar(16)', (c) => c.notNull().defaultTo('public'))
    .addColumn('slug_changed_at', sql.raw(t.timestamp))
    .addColumn('downloads_count', sql.raw(t.bigint), (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('deleted_at', sql.raw(t.timestamp))
    .addCheckConstraint('products_slug_lowercase', sql`slug = lower(slug)`)
    .addCheckConstraint(
      'products_kind',
      sql`kind in ('bukkit_plugin', 'mod_client', 'mod_server')`,
    )
    .addCheckConstraint(
      'products_visibility',
      sql`visibility in ('public', 'unlisted', 'private')`,
    )
    .execute();

  await db.schema
    .createIndex('ix_products_owner')
    .on('products')
    .column('owner_org_id')
    .execute();

  await db.schema
    .createTable('product_slug_history')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('product_id', sql.raw(t.id), (c) => c.notNull().references('products.id'))
    .addColumn('slug', 'varchar(64)', (c) => c.notNull())
    .addColumn('released_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('product_versions')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('product_id', sql.raw(t.id), (c) =>
      c.notNull().references('products.id').onDelete('cascade'),
    )
    .addColumn('version', 'varchar(64)', (c) => c.notNull())
    .addColumn('version_norm', 'varchar(64)', (c) => c.notNull())
    .addColumn('channel', 'varchar(16)', (c) => c.notNull().defaultTo('release'))
    .addColumn('changelog', sql.raw(t.text))
    .addColumn('is_latest', sql.raw(t.boolean), (c) => c.notNull().defaultTo(0))
    .addColumn('published_at', sql.raw(t.timestamp))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addUniqueConstraint('uq_product_version', ['product_id', 'version'])
    .addCheckConstraint(
      'product_versions_channel',
      sql`channel in ('release', 'beta', 'alpha')`,
    )
    .execute();

  // The plugin orders by this, never by `version` -- compared as text,
  // '1.9.0' sorts above '1.10.0' and an update would run backwards.
  await db.schema
    .createIndex('ix_product_versions_order')
    .on('product_versions')
    .columns(['product_id', 'version_norm'])
    .execute();

  // The primary key is `version_id` and that is the whole point: "one product
  // page, one jar" becomes a thing the database cannot represent otherwise.
  await db.schema
    .createTable('product_files')
    .addColumn('version_id', sql.raw(t.id), (c) =>
      c.primaryKey().references('product_versions.id').onDelete('cascade'),
    )
    .addColumn('file_name', 'varchar(255)', (c) => c.notNull())
    .addColumn('storage_key', 'varchar(255)', (c) => c.notNull().unique())
    .addColumn('size_bytes', sql.raw(t.bigint), (c) => c.notNull())
    .addColumn('sha256', 'char(64)', (c) => c.notNull())
    .addColumn('content_type', 'varchar(64)', (c) => c.notNull())
    .addColumn('uploaded_by', sql.raw(t.id), (c) => c.references('accounts.id'))
    .addColumn('upload_source', 'varchar(8)', (c) => c.notNull())
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addCheckConstraint('product_files_size_positive', sql`size_bytes > 0`)
    .addCheckConstraint('product_files_source', sql`upload_source in ('web', 'ci')`)
    // A file name that is a path is refused here, not only in a handler.
    .addCheckConstraint(
      'product_files_name_is_basename',
      sql`file_name not like '%/%' and file_name not like '%\\%'`,
    )
    .execute();

  await db.schema
    .createTable('product_compatibility')
    .addColumn('version_id', sql.raw(t.id), (c) =>
      c.notNull().references('product_versions.id').onDelete('cascade'),
    )
    .addColumn('platform', 'varchar(16)', (c) => c.notNull())
    .addColumn('minecraft_version', 'varchar(32)', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_product_compatibility', [
      'version_id',
      'platform',
      'minecraft_version',
    ])
    .execute();
}

async function fleet(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  await db.schema
    .createTable('minecraft_servers')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('owner_account_id', sql.raw(t.id), (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('server_key', 'char(26)', (c) => c.notNull().unique())
    .addColumn('server_url', sql.raw(t.text))
    .addColumn('name', 'varchar(64)', (c) => c.notNull())
    .addColumn('platform', 'varchar(16)')
    .addColumn('mc_version', 'varchar(32)')
    .addColumn('agent_version', 'varchar(32)')
    .addColumn('last_seen_at', sql.raw(t.timestamp))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('ix_servers_owner')
    .on('minecraft_servers')
    .column('owner_account_id')
    .execute();

  // Unique within a server, repeated across servers -- which is what the
  // original sketch meant by "unique, and it must duplicate".
  await db.schema
    .createTable('server_plugins')
    .addColumn('server_id', sql.raw(t.id), (c) =>
      c.notNull().references('minecraft_servers.id').onDelete('cascade'),
    )
    .addColumn('plugin_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('product_id', sql.raw(t.id), (c) => c.references('products.id'))
    .addColumn('installed_version', 'varchar(64)')
    .addColumn('installed_sha256', 'char(64)')
    .addColumn('desired_version', 'varchar(64)')
    .addColumn('state', 'varchar(16)', (c) => c.notNull().defaultTo('installed'))
    .addColumn('last_error', sql.raw(t.text))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_server_plugins', ['server_id', 'plugin_id'])
    .addCheckConstraint(
      'server_plugins_state',
      sql`state in ('installed', 'pending_update', 'pending_delete', 'failed')`,
    )
    .execute();

  await db.schema
    .createTable('external_sources')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('product_id', sql.raw(t.id), (c) => c.references('products.id').onDelete('cascade'))
    .addColumn('server_id', sql.raw(t.id), (c) =>
      c.references('minecraft_servers.id').onDelete('cascade'),
    )
    .addColumn('source_type', 'varchar(24)', (c) => c.notNull())
    .addColumn('source_ref', sql.raw(t.text), (c) => c.notNull())
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .addCheckConstraint(
      'external_sources_type',
      sql`source_type in ('spigotmc', 'modrinth', 'hangar', 'github_release', 'direct_url')`,
    )
    .execute();
}

async function logs(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  await db.schema
    .createTable('audit_events')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('actor_account_id', sql.raw(t.id), (c) => c.references('accounts.id'))
    .addColumn('actor_token_id', sql.raw(t.id), (c) => c.references('api_tokens.id'))
    .addColumn('subject_type', 'varchar(32)', (c) => c.notNull())
    .addColumn('subject_id', 'varchar(64)', (c) => c.notNull())
    .addColumn('action', 'varchar(64)', (c) => c.notNull())
    .addColumn('metadata', sql.raw(t.json))
    .addColumn('ip', 'varchar(45)')
    .addColumn('user_agent', sql.raw(t.text))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  await db.schema
    .createIndex('ix_audit_subject')
    .on('audit_events')
    .columns(['subject_type', 'subject_id', 'created_at'])
    .execute();

  await db.schema
    .createTable('fleet_events')
    .addColumn('id', sql.raw(t.id), (c) => c.primaryKey())
    .addColumn('server_id', sql.raw(t.id), (c) =>
      c.notNull().references('minecraft_servers.id').onDelete('cascade'),
    )
    .addColumn('product_id', sql.raw(t.id), (c) => c.references('products.id'))
    .addColumn('version_id', sql.raw(t.id), (c) => c.references('product_versions.id'))
    .addColumn('action', 'varchar(16)', (c) => c.notNull())
    .addColumn('detail', sql.raw(t.json))
    .addColumn('bytes_sent', sql.raw(t.bigint))
    .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
    .execute();

  // High volume by design -- every server, every interval. Indexed for pruning
  // by age, never joined on a request path.
  await db.schema
    .createIndex('ix_fleet_events_server_time')
    .on('fleet_events')
    .columns(['server_id', 'created_at'])
    .execute();
}

/**
 * The three "at most one row where X" rules.
 *
 * PostgreSQL and SQLite get a partial unique index. MySQL and MariaDB have none,
 * so they get a stored generated column that is NULL unless the condition holds
 * — their unique indexes ignore NULLs, which produces the same guarantee through
 * a different mechanism.
 */
async function conditionalUniques(db: Kysely<unknown>, t: DialectTypes): Promise<void> {
  if (t.supportsPartialIndex) {
    await sql`create unique index uq_one_primary_email on account_emails (account_id) where is_primary = 1`.execute(
      db,
    );
    await sql`create unique index uq_one_owner_per_org on org_members (org_id) where role = 'owner'`.execute(
      db,
    );
    await sql`create unique index uq_one_latest_per_channel on product_versions (product_id, channel) where is_latest = 1`.execute(
      db,
    );
    return;
  }

  await sql`alter table account_emails
    add column primary_marker char(26)
    generated always as (case when is_primary = 1 then account_id else null end) stored,
    add unique key uq_one_primary_email (primary_marker)`.execute(db);

  await sql`alter table org_members
    add column owner_marker char(26)
    generated always as (case when role = 'owner' then org_id else null end) stored,
    add unique key uq_one_owner_per_org (owner_marker)`.execute(db);

  await sql`alter table product_versions
    add column latest_marker varchar(80)
    generated always as (case when is_latest = 1 then concat(product_id, ':', channel) else null end) stored,
    add unique key uq_one_latest_per_channel (latest_marker)`.execute(db);
}
