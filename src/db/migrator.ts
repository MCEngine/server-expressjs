import type { Kysely } from 'kysely';
import { Migrator, type Migration, type MigrationProvider } from 'kysely/migration';
import type { Database } from './schema.js';
import type { DialectTypes } from './types.js';
import { migration001Initial } from './migrations/001-initial.js';
import { migration002News } from './migrations/002-news.js';

/**
 * The migrations, in order, as a literal list.
 *
 * Kysely's file-system provider reads a directory at runtime, which does not
 * survive being compiled to `dist/` or bundled. Listing them means the set that
 * ships is the set that was compiled, and adding one is a visible diff here
 * rather than a file that silently is or is not present.
 */
export function migrations(types: DialectTypes): Record<string, Migration> {
  return {
    '001-initial': migration001Initial(types),
    '002-news': migration002News(types),
  };
}

class StaticProvider implements MigrationProvider {
  constructor(private readonly types: DialectTypes) {}
  getMigrations(): Promise<Record<string, Migration>> {
    return Promise.resolve(migrations(this.types));
  }
}

export interface MigrateResult {
  readonly applied: readonly string[];
}

/** Runs every pending migration. Idempotent: a second call applies nothing. */
export async function migrateToLatest(
  db: Kysely<Database>,
  types: DialectTypes,
): Promise<MigrateResult> {
  const migrator = new Migrator({ db, provider: new StaticProvider(types) });
  const { error, results } = await migrator.migrateToLatest();

  if (error) {
    const failed = results?.find((r) => r.status === 'Error')?.migrationName;
    throw new Error(
      `Migration failed${failed ? ` at ${failed}` : ''}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return { applied: (results ?? []).map((r) => r.migrationName) };
}
