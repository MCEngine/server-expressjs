import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';
import { createDatabase, databaseProbe, dialectTypes, migrateToLatest } from './db/index.js';

const config = loadConfig();
const logger = createLogger(config);

const database = await createDatabase(config);

// Migrations run at startup rather than as a separate deploy step. The set is a
// literal list in `src/db/migrator.ts`, so the migrations that ship are the ones
// that were compiled, and applying them is idempotent.
const { applied } = await migrateToLatest(database.db, dialectTypes(config.DATABASE_PROVIDER));
if (applied.length > 0) logger.info('migrations applied', { migrations: applied });

const app = createApp({ config, logger, probes: [databaseProbe(database)] });

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
