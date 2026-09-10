import type { Config } from '../config.js';

export type SqlProvider = Config['DATABASE_PROVIDER'];

/**
 * The column types and index tricks that genuinely differ between the four SQL
 * engines, in one place.
 *
 * Everything else in a migration is written once. This exists because three
 * differences cannot be papered over — a timestamp's storage type, whether the
 * engine has a native boolean, and whether it supports a partial unique index —
 * and pretending otherwise produces a schema that only really works on one of
 * them.
 */
export interface DialectTypes {
  readonly provider: SqlProvider;
  /** A 26-character ULID. */
  readonly id: string;
  readonly timestamp: string;
  readonly boolean: string;
  readonly bigint: string;
  readonly text: string;
  readonly json: string;
  /**
   * Whether `CREATE UNIQUE INDEX ... WHERE` is supported.
   *
   * PostgreSQL and SQLite have it. MySQL and MariaDB do not, and are given a
   * generated column that is NULL when the condition is false instead — their
   * unique indexes ignore NULLs, which produces the same guarantee.
   */
  readonly supportsPartialIndex: boolean;
}

const SQLITE: DialectTypes = {
  provider: 'sqlite',
  id: 'text',
  timestamp: 'text',
  boolean: 'integer',
  bigint: 'integer',
  text: 'text',
  json: 'text',
  supportsPartialIndex: true,
};

const POSTGRES: DialectTypes = {
  provider: 'postgresql',
  id: 'char(26)',
  timestamp: 'timestamptz',
  boolean: 'boolean',
  bigint: 'bigint',
  text: 'text',
  json: 'jsonb',
  supportsPartialIndex: true,
};

const MYSQL = (provider: 'mysql' | 'mariadb'): DialectTypes => ({
  provider,
  id: 'char(26)',
  // Millisecond precision, and the connection is pinned to UTC in
  // `dialect.ts` so a server's local timezone never reaches a stored value.
  timestamp: 'datetime(3)',
  boolean: 'tinyint(1)',
  bigint: 'bigint',
  // MySQL cannot index a `text` column without a prefix length, so anything
  // that might be indexed uses `varchar` and anything long uses `text`.
  text: 'text',
  json: 'json',
  supportsPartialIndex: false,
});

export function dialectTypes(provider: SqlProvider): DialectTypes {
  switch (provider) {
    case 'sqlite':
      return SQLITE;
    case 'postgresql':
      return POSTGRES;
    case 'mysql':
      return MYSQL('mysql');
    case 'mariadb':
      return MYSQL('mariadb');
  }
}
