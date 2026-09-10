import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { createDatabase, databaseProbe, dialectTypes, migrateToLatest } from './db/index.js';
import { systemClock } from './lib/clock.js';
import { createIdentityRepository, createIdentityService } from './modules/identity/index.js';
import { createAuthRepository, createAuthService } from './modules/auth/index.js';
import { createProductRepository, createProductService } from './modules/product/index.js';
import { createDiskStorage } from './storage/index.js';
import { createFleetRepository, createFleetService } from './modules/fleet/index.js';
import { createAuditService } from './modules/audit/index.js';
import { createSourceService } from './modules/source/index.js';

const config = loadConfig();
const logger = createLogger(config);

const database = await createDatabase(config);

// Migrations run at startup rather than as a separate deploy step. The set is a
// literal list in `src/db/migrator.ts`, so the migrations that ship are the ones
// that were compiled, and applying them is idempotent.
const { applied } = await migrateToLatest(database.db, dialectTypes(config.DATABASE_PROVIDER));
if (applied.length > 0) logger.info('migrations applied', { migrations: applied });

const identity = createIdentityService(createIdentityRepository(database.db), systemClock);
const auth = createAuthService(
  createAuthRepository(database.db),
  identity,
  config,
  systemClock,
);

const storage = createDiskStorage(config.STORAGE_DIR);
const products = createProductService(
  createProductRepository(database.db),
  identity,
  storage,
  systemClock,
);

const fleet = createFleetService(createFleetRepository(database.db), products, systemClock);

const audit = createAuditService(database.db, systemClock, (error) => {
  // A logging failure must never fail the request that caused it, but it must
  // not be silent either.
  logger.error('audit write failed', {
    error: error instanceof Error ? error.message : String(error),
  });
});

const sources = createSourceService(database.db, storage, systemClock);

const app = createApp({
  config,
  logger,
  probes: [databaseProbe(database)],
  services: { identity, auth, products, fleet, storage, audit, sources },
});

const server = app.listen(config.PORT, () => {
  logger.info('server listening', {
    port: config.PORT,
    env: config.NODE_ENV,
    database: config.DATABASE_PROVIDER,
  });
});

/**
 * Stop accepting connections, let in-flight requests finish, close the pool,
 * and exit.
 *
 * Without this, a deploy cuts an upload mid-transaction; the whole point of the
 * upload being one transaction is that it either lands or does not.
 */
const shutdown = (signal: string) => {
  logger.info('shutting down', { signal });
  server.close(() => {
    void database.close().then(() => process.exit(0));
  });

  // A request that has not finished in ten seconds is not going to.
  setTimeout(() => {
    logger.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
