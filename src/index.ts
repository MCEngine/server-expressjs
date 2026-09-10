import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createLogger } from './lib/logger.js';

const config = loadConfig();
const logger = createLogger(config);
const app = createApp({ config, logger });

const server = app.listen(config.PORT, () => {
  logger.info('server listening', {
    port: config.PORT,
    env: config.NODE_ENV,
    database: config.DATABASE_PROVIDER,
  });
});

/**
 * Stop accepting connections, let in-flight requests finish, and exit.
 *
 * Without this, a deploy cuts an upload mid-transaction; the whole point of the
 * upload being one transaction is that it either lands or does not.
 */
const shutdown = (signal: string) => {
  logger.info('shutting down', { signal });
  server.close(() => process.exit(0));

  // A request that has not finished in ten seconds is not going to.
  setTimeout(() => {
    logger.error('shutdown timed out, exiting anyway');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
