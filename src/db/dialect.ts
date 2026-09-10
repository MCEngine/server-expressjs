import { Kysely, type Dialect } from 'kysely';
import type { Config } from '../config.js';
import type { Database } from './schema.js';
import { NormalizeRowsPlugin, SqliteBooleanPlugin } from './plugins.js';

/**
 * Builds the Kysely dialect for the configured provider.
 *
 * Each driver is imported **inside** its branch, so a SQLite deployment never
 * loads `pg` and a PostgreSQL deployment never loads `better-sqlite3` — which
 * matters for the native one, since it would otherwise have to build on a
 * machine that has no use for it.
 */
async function createDialect(config: Config): Promise<Dialect> {
  switch (config.DATABASE_PROVIDER) {
    case 'sqlite': {
      const { SqliteDialect } = await import('kysely');
      const { default: SQLite } = await import('better-sqlite3');
      const file = config.DATABASE_URL.replace(/^file:/, '');
      const database = new SQLite(file);

      // Without WAL, a reader blocks a writer, and the upload transaction is
      // the one place that would be felt. `foreign_keys` is off by default in
      // SQLite, which would silently discard every constraint in the schema.
      database.pragma('journal_mode = WAL');
      database.pragma('foreign_keys = ON');

      return new SqliteDialect({ database });
    }

    case 'postgresql': {
      const { PostgresDialect } = await import('kysely');
      const { default: pg } = await import('pg');
      return new PostgresDialect({
        pool: new pg.Pool({ connectionString: config.DATABASE_URL, max: 10 }),
      });
    }

    case 'mysql':
    case 'mariadb': {
      const { MysqlDialect } = await import('kysely');
      const { createPool } = await import('mysql2');
      return new MysqlDialect({
        pool: createPool({
          uri: config.DATABASE_URL,
          connectionLimit: 10,
          // Pin the session to UTC so a server's local timezone never reaches a
          // stored `datetime`, and hand back strings rather than Date objects
          // built in the process's timezone.
          timezone: 'Z',
          dateStrings: true,
        }),
      });
    }
  }
}

export interface DatabaseHandle {
  readonly db: Kysely<Database>;
  readonly provider: Config['DATABASE_PROVIDER'];
  /** Fails when the database is unreachable. Wired into `/health/ready`. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export async function createDatabase(config: Config): Promise<DatabaseHandle> {
  const dialect = await createDialect(config);

  // SQLite alone needs the boolean rewrite: its driver refuses to bind one, and
  // the column is an integer. pg and mysql2 accept a boolean directly, and
  // converting for them would write 1 into a real boolean column.
  const plugins =
    config.DATABASE_PROVIDER === 'sqlite'
      ? [new SqliteBooleanPlugin(), new NormalizeRowsPlugin()]
      : [new NormalizeRowsPlugin()];

  const db = new Kysely<Database>({ dialect, plugins });
  const { sql } = await import('kysely');

  return {
    db,
    provider: config.DATABASE_PROVIDER,
    async ping() {
      await sql`select 1`.execute(db);
    },
    async close() {
      await db.destroy();
    },
  };
}
