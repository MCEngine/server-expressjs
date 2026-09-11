import { Router } from 'express';
import type { Config } from '../config.js';

/**
 * What a client needs to know about this deployment before signing in.
 *
 * Public and unauthenticated, because the one thing it currently answers is a
 * question you have before you have any credentials: is there a demo account,
 * and what is it?
 *
 * **Returning a password here is deliberate.** It is a credential the operator
 * published by turning `DEMO_ACCOUNT_ENABLED` on; printing it in a startup log
 * while withholding it from the page that needs it would be theatre. With the
 * flag off there is no account and nothing to return.
 */
export function createMetaRouter(config: Config): Router {
  const router = Router();

  router.get('/meta', (_req, res) => {
    res.json({
      demo_account: config.DEMO_ACCOUNT_ENABLED
        ? { email: config.DEMO_ACCOUNT_EMAIL, password: config.DEMO_ACCOUNT_PASSWORD }
        : null,
    });
  });

  return router;
}
