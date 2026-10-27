import type { Insertable, Kysely } from 'kysely';
import type { Database } from './schema.js';

/** The tables whose key is an auto-numbered `id`. */
type SerialTable = {
  [K in keyof Database]: Database[K] extends { id: infer I } ? (I extends string ? never : K) : never;
}[keyof Database];

/**
 * Inserts one row and returns the number the database gave it.
 *
 * PostgreSQL only reports it through `RETURNING`; MySQL has no `RETURNING`
 * and reports it as the insert id. Asking the adapter which it supports keeps
 * that difference here, in `src/db/`, instead of in every repository that
 * needs a new row's id.
 */
export async function insertSerial<T extends SerialTable>(
  db: Kysely<Database>,
  table: T,
  values: Insertable<Database[T]>,
): Promise<number> {
  // Loosely typed inside: the constraint above already says the table has an id.
  const loose = db as unknown as Kysely<Record<string, { id: number }>>;
  const query = loose.insertInto(table).values(values as never);
  if (db.getExecutor().adapter.supportsReturning) {
    const row = await query.returning('id').executeTakeFirstOrThrow();
    return Number(row.id);
  }
  const result = await query.executeTakeFirstOrThrow();
  return Number(result.insertId);
}
