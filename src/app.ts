import express, { type Express } from 'express';
import type { Config } from './config.js';
import { createLogger, type Logger } from './lib/logger.js';
import { requestContext } from './http/requestContext.js';
import { createErrorHandler, notFoundHandler } from './http/errorHandler.js';
import { createHealthRouter, type ReadinessProbe } from './routes/health.js';

export interface AppOptions {
  readonly config: Config;
  readonly logger?: Logger;
  readonly probes?: readonly ReadinessProbe[];
}

/**
 * Builds the Express application.
 *
 * Everything it depends on arrives as an argument, and it never starts
 * listening — that is `src/index.ts`. A test builds an app per suite and drives
 * it in-process, so no port is bound and no file shares state between suites.
 */
export function createApp({ config, logger, probes = [] }: AppOptions): Express {
  const log = logger ?? createLogger(config);
  const app = express();

  // The service sits behind a proxy in every deployment, and rate limiting and
  // audit logging both record the client address. Without this, every request
  // appears to come from the proxy.
  app.set('trust proxy', true);

  // Express advertises itself by default. There is no reason to tell a scanner
  // which server it is talking to.
  app.disable('x-powered-by');

  app.use(requestContext);

  // A hard ceiling on JSON bodies. Artifact uploads are multipart and are
  // handled by their own route with its own limit; nothing else here has any
  // business being large.
  app.use(express.json({ limit: '1mb' }));

  app.use(createHealthRouter(probes));

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));

  // Referenced so the config is threaded through even before routes read it,
  // and so adding the first one does not change this signature.
  void config;

  return app;
}
