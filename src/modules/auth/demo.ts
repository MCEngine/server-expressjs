import type { Config } from '../../config.js';
import type { Logger } from '../../lib/logger.js';
import type { AuthService } from './service.js';

/**
 * Creates the demo account, if it is enabled and does not already exist.
 *
 * Goes through the same `register` the panel calls. Nothing about this account
 * is special except that it is already there — which is the point: an evaluation
 * that signs in as something the real path could not have produced demonstrates
 * nothing.
 *
 * **Never fails startup.** A demo account is a convenience, and refusing to
 * serve because one could not be created would turn a convenience into an
 * outage. It is also idempotent: a restart, or a redeploy onto a volume that
 * already has it, is a no-op.
 */
export async function seedDemoAccount(
  config: Config,
  auth: AuthService,
  logger: Logger,
): Promise<void> {
  if (!config.DEMO_ACCOUNT_ENABLED) return;

  logger.warn('demo account enabled', {
    email: config.DEMO_ACCOUNT_EMAIL,
    risk:
      'This is a real account with the usual permissions. Anyone who can reach the panel can ' +
      'sign in as it, create an organization, and publish artifacts. Do not leave it on for a ' +
      'deployment you would mind a stranger publishing into.',
  });

  try {
    await auth.register(
      {
        handle: config.DEMO_ACCOUNT_HANDLE,
        displayName: 'Demo',
        email: config.DEMO_ACCOUNT_EMAIL,
        password: config.DEMO_ACCOUNT_PASSWORD,
      },
      { deviceLabel: 'seed' },
    );
    logger.info('demo account created', { handle: config.DEMO_ACCOUNT_HANDLE });
  } catch (cause) {
    /*
     * Almost always "that handle is taken" on the second boot, which is the
     * expected path rather than a problem. Anything else is worth seeing, but
     * not worth refusing to start over.
     */
    logger.info('demo account not created; assuming it already exists', {
      handle: config.DEMO_ACCOUNT_HANDLE,
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
