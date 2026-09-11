import { errors } from '../../errors.js';
import type { AccountRecord } from './repository.js';
import type { IdentityService } from './service.js';
import type { OrgRole } from './validation.js';

/**
 * May `callerId` act for `account`?
 *
 * The one rule, in one place, because two routers ask it: your own user account
 * is yours, and an organization is yours at the role given.
 *
 * **A user account that is not the caller's is `404`, not `403`.** Telling a
 * stranger "you may not administer this account" confirms the account exists;
 * `requireRole` answers a non-member the same way and for the same reason.
 */
export async function assertMayAdminister(
  identity: IdentityService,
  account: AccountRecord,
  callerId: string,
  role: OrgRole = 'admin',
): Promise<void> {
  if (account.type === 'user') {
    if (account.id !== callerId) throw errors.notFound('account_not_found', 'No such account.');
    return;
  }
  await identity.requireRole(account.id, callerId, role);
}
