export { createDatabase, type DatabaseHandle } from './dialect.js';
export { migrateToLatest, migrations } from './migrator.js';
export { dialectTypes, type DialectTypes, type SqlProvider } from './types.js';
export type * from './schema.js';

import type { DatabaseHandle } from './dialect.js';
import type { ReadinessProbe } from '../routes/health.js';

/**
 * The readiness probe for the database.
 *
 * A function rather than a constant so the handle arrives as an argument — which
 * is what lets `createApp` be built in a test against a probe that fails, the
 * case a real database makes hard to arrange.
 */
export function databaseProbe(handle: DatabaseHandle): ReadinessProbe {
  return { name: 'database', check: () => handle.ping() };
}
