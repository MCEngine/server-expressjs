import { Router } from 'express';
import { handleSchema } from './validation.js';
import { errors } from '../../errors.js';
import type { AccountRecord } from './repository.js';
import type { IdentityService } from './service.js';

/**
 * The public view of an account.
 *
 * A field that is unset is **omitted**, not sent as `null`: the panel's rule is
 * "show it only when set", and an absent key is harder to render by accident
 * than a null. Nothing here is private — no email, no status, no ids of related
 * rows — because this route is reachable without a credential.
 */
export function publicAccount(account: AccountRecord): Record<string, unknown> {
  return {
    id: account.id,
    type: account.type,
    handle: account.handle,
    display_name: account.display_name,
    created_at: account.created_at,
    ...(account.bio === null ? {} : { bio: account.bio }),
    ...(account.avatar_url === null ? {} : { avatar_url: account.avatar_url }),
  };
}

export function createIdentityRouter(identity: IdentityService): Router {
  const router = Router();

  router.get('/accounts/:handle', async (req, res) => {
    const parsed = handleSchema.safeParse(req.params.handle);
    if (!parsed.success) {
      // A malformed handle cannot name anything, so this is 404 rather than
      // 400 -- it says the same thing as a well-formed handle nobody holds.
      throw errors.notFound('account_not_found', 'No such account.');
    }

    const account = await identity.getByHandle(parsed.data);
    res.json(publicAccount(account));
  });

  return router;
}
