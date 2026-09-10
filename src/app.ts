import express, { type Express } from 'express';
import type { Config } from './config.js';
import { createLogger, type Logger } from './lib/logger.js';
import { requestContext } from './http/requestContext.js';
import { createErrorHandler, notFoundHandler } from './http/errorHandler.js';
import { createHealthRouter, type ReadinessProbe } from './routes/health.js';
import { createIdentityRouter, type IdentityService } from './modules/identity/index.js';
import { attachActor, createAuthRouter, type AuthService } from './modules/auth/index.js';
import { createProductRouter, type ProductService } from './modules/product/index.js';
import { createFleetRouter, type FleetService } from './modules/fleet/index.js';
import { createAuditRouter, nullAuditService, type AuditService } from './modules/audit/index.js';
import { createSourceRouter, type SourceService } from './modules/source/index.js';
import type { Storage } from './storage/index.js';

/**
 * The domain services the app mounts routes for.
 *
 * Optional, and a missing one simply mounts no routes: the health endpoints have
 * to work in a container whose database has not come up, and a test that only
 * exercises the error envelope should not have to build a database to do it.
 */
export interface AppServices {
  readonly identity?: IdentityService;
  readonly auth?: AuthService;
  readonly products?: ProductService;
  readonly fleet?: FleetService;
  readonly storage?: Storage;
  /**
   * Where actions are recorded. Defaults to one that records nothing, so a test
   * about routing does not have to build a database to exercise a route.
   */
  readonly audit?: AuditService;
  readonly sources?: SourceService;
}

export interface AppOptions {
  readonly config: Config;
  readonly logger?: Logger;
  readonly probes?: readonly ReadinessProbe[];
  readonly services?: AppServices;
}

/**
 * Builds the Express application.
 *
 * Everything it depends on arrives as an argument, and it never starts
 * listening — that is `src/index.ts`. A test builds an app per suite and drives
 * it in-process, so no port is bound and no file shares state between suites.
 */
export function createApp({ config, logger, probes = [], services = {} }: AppOptions): Express {
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

  // Every domain route is under /api/v1. Health is not: an orchestrator probing
  // it should not have to track the API version.
  //
  // The actor is resolved before any route runs and rejected by none of them:
  // several routes are public, and the guards are mounted per route.
  const audit = services.audit ?? nullAuditService();

  if (services.auth !== undefined) {
    app.use('/api/v1', attachActor(services.auth));
    app.use('/api/v1', createAuthRouter(services.auth, config.NODE_ENV === 'production', audit));
  }

  if (services.identity !== undefined) {
    app.use('/api/v1', createIdentityRouter(services.identity, audit));
  }

  if (services.products !== undefined && services.identity !== undefined && services.storage !== undefined) {
    app.use(
      '/api/v1',
      createProductRouter(services.products, services.identity, services.storage, audit, services.fleet),
    );
  }

  if (services.fleet !== undefined) {
    app.use('/api/v1', createFleetRouter(services.fleet, audit));

    if (services.identity !== undefined && services.audit !== undefined) {
      app.use('/api/v1', createAuditRouter(services.audit, services.identity, services.fleet));
    }
  }

  if (services.sources !== undefined && services.storage !== undefined) {
    app.use('/api/v1', createSourceRouter(services.sources, services.storage));
  }

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));

  return app;
}
