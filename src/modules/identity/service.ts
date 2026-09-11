import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { addDays, daysBetween, iso, type Clock } from '../../lib/clock.js';
import type { MembershipTier } from '../../db/schema.js';
import {
  HANDLE_COOLDOWN_DAYS,
  isReservedHandle,
  roleAtLeast,
  type OrgRole,
} from './validation.js';
import type {
  AccountRecord,
  EmailRecord,
  IdentityRepository,
  MemberRecord,
  OrgSettingsRecord,
  ProfilePatch,
} from './repository.js';

/** Quota and per-file limits by tier. The free tier is the default. */
export const TIER_LIMITS: Record<MembershipTier, { quotaBytes: number; maxFileBytes: number }> = {
  free: { quotaBytes: 1_073_741_824, maxFileBytes: 33_554_432 },
  pro: { quotaBytes: 53_687_091_200, maxFileBytes: 268_435_456 },
  enterprise: { quotaBytes: 549_755_813_888, maxFileBytes: 1_073_741_824 },
};

export interface IdentityService {
  createUser(input: { handle: string; displayName: string; email: string }): Promise<AccountRecord>;
  createOrg(input: { handle: string; displayName: string; ownerUserId: string }): Promise<AccountRecord>;
  getByHandle(handle: string): Promise<AccountRecord>;
  requireAccount(id: string): Promise<AccountRecord>;
  updateProfile(accountId: string, patch: ProfilePatch): Promise<AccountRecord>;
  changeHandle(accountId: string, next: string): Promise<AccountRecord>;

  listEmails(accountId: string): Promise<EmailRecord[]>;
  addEmail(accountId: string, email: string): Promise<EmailRecord>;
  makePrimary(accountId: string, emailId: string): Promise<void>;
  removeEmail(accountId: string, emailId: string): Promise<void>;

  listMembers(orgId: string): Promise<MemberRecord[]>;
  addMember(orgId: string, userId: string, role: OrgRole, invitedBy: string): Promise<void>;
  changeRole(orgId: string, userId: string, role: OrgRole): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;
  transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void>;

  requireRole(orgId: string, userId: string, atLeast: OrgRole): Promise<OrgRole>;
  orgSettings(orgId: string): Promise<OrgSettingsRecord>;
}

export function createIdentityService(
  repo: IdentityRepository,
  clock: Clock,
): IdentityService {
  const now = () => iso(clock.now());

  /** Rejects a handle that is reserved or already held, before the database does. */
  const assertHandleAvailable = async (handle: string): Promise<void> => {
    if (isReservedHandle(handle)) {
      throw errors.conflict('handle_reserved', `The handle "${handle}" is reserved.`);
    }
    if (await repo.handleExists(handle)) {
      throw errors.conflict('handle_taken', `The handle "${handle}" is already in use.`);
    }
  };

  const requireAccount = async (id: string): Promise<AccountRecord> => {
    const account = await repo.findAccountById(id);
    if (account === undefined) throw errors.notFound('account_not_found', 'No such account.');
    return account;
  };

  const requireOrg = async (orgId: string): Promise<AccountRecord> => {
    const org = await requireAccount(orgId);
    // The database cannot check this: no portable CHECK can follow a foreign key
    // to test the referenced row's type.
    if (org.type !== 'org') {
      throw errors.badRequest('not_an_org', 'That account is a user, not an organization.');
    }
    return org;
  };

  return {
    async createUser({ handle, displayName, email }) {
      await assertHandleAvailable(handle);
      if (await repo.emailExists(email)) {
        // Deliberately the same code and wording as a taken handle would get
        // for a different field: it says the address is in use without
        // confirming which account holds it.
        throw errors.conflict('email_taken', 'That email address is already in use.');
      }

      const id = ulid();
      const at = now();
      await repo.insertAccount({ id, type: 'user', handle, displayName, at });
      await repo.insertEmail({
        id: ulid(),
        accountId: id,
        email,
        isPrimary: true,
        verifiedAt: null,
        at,
      });
      return requireAccount(id);
    },

    async createOrg({ handle, displayName, ownerUserId }) {
      const owner = await requireAccount(ownerUserId);
      if (owner.type !== 'org' && owner.type !== 'user') {
        throw errors.badRequest('invalid_owner', 'An organization owner must be a user.');
      }
      if (owner.type === 'org') {
        throw errors.badRequest('invalid_owner', 'An organization cannot own another organization.');
      }
      await assertHandleAvailable(handle);

      const id = ulid();
      const at = now();
      await repo.insertAccount({ id, type: 'org', handle, displayName, at });

      // The creator is the owner, and the partial unique index means there can
      // never be a second one.
      await repo.insertMember({ orgId: id, userId: ownerUserId, role: 'owner', invitedBy: null, at });

      const limits = TIER_LIMITS.free;
      await repo.insertOrgSettings({
        orgId: id,
        tier: 'free',
        quotaBytes: limits.quotaBytes,
        maxFileBytes: limits.maxFileBytes,
        at,
      });

      return requireAccount(id);
    },

    async getByHandle(handle) {
      const account = await repo.findAccountByHandle(handle);
      if (account === undefined) throw errors.notFound('account_not_found', 'No such account.');
      return account;
    },

    requireAccount,

    async updateProfile(accountId, patch) {
      await requireAccount(accountId);
      await repo.updateProfile(accountId, patch, now());
      return requireAccount(accountId);
    },

    async changeHandle(accountId, next) {
      const account = await requireAccount(accountId);
      if (account.handle === next) return account;

      if (account.handle_changed_at !== null) {
        const last = new Date(account.handle_changed_at);
        const elapsed = daysBetween(last, clock.now());
        if (elapsed < HANDLE_COOLDOWN_DAYS) {
          const availableAt = addDays(last, HANDLE_COOLDOWN_DAYS);
          throw errors.conflict(
            'handle_cooldown',
            `This handle was changed ${Math.floor(elapsed)} days ago and can be changed again in ${Math.ceil(HANDLE_COOLDOWN_DAYS - elapsed)} days.`,
            { changed_at: account.handle_changed_at, available_at: iso(availableAt) },
          );
        }
      }

      await assertHandleAvailable(next);
      await repo.replaceHandle(accountId, account.handle, next, now(), ulid());
      return requireAccount(accountId);
    },

    listEmails: (accountId) => repo.listEmails(accountId),

    async addEmail(accountId, email) {
      await requireAccount(accountId);
      if (await repo.emailExists(email)) {
        throw errors.conflict('email_taken', 'That email address is already in use.');
      }
      const id = ulid();
      const existing = await repo.listEmails(accountId);
      await repo.insertEmail({
        id,
        accountId,
        email,
        // The first address on an account is primary; a later one is not,
        // because promoting it should be a deliberate act.
        isPrimary: existing.length === 0,
        verifiedAt: null,
        at: now(),
      });
      const created = await repo.findEmail(id);
      if (created === undefined) throw errors.notFound('email_not_found', 'No such email address.');
      return created;
    },

    async makePrimary(accountId, emailId) {
      const email = await repo.findEmail(emailId);
      if (email === undefined || email.account_id !== accountId) {
        throw errors.notFound('email_not_found', 'No such email address.');
      }
      if (email.verified_at === null) {
        // Promoting an unverified address would let anyone who can add one
        // redirect the account's password resets to it.
        throw errors.badRequest(
          'email_not_verified',
          'Verify this address before making it the primary one.',
        );
      }
      await repo.setPrimaryEmail(accountId, emailId, now());
    },

    async removeEmail(accountId, emailId) {
      const email = await repo.findEmail(emailId);
      if (email === undefined || email.account_id !== accountId) {
        throw errors.notFound('email_not_found', 'No such email address.');
      }
      if (email.is_primary) {
        throw errors.badRequest(
          'email_is_primary',
          'Make another address primary before removing this one.',
        );
      }
      await repo.deleteEmail(emailId);
    },

    listMembers: (orgId) => repo.listMembers(orgId),

    async addMember(orgId, userId, role, invitedBy) {
      await requireOrg(orgId);
      const user = await requireAccount(userId);
      if (user.type !== 'user') {
        throw errors.badRequest('not_a_user', 'Only a user can be a member of an organization.');
      }
      if (role === 'owner') {
        // Ownership moves by transfer, never by invitation -- otherwise the
        // insert simply hits the unique index with an unhelpful message.
        throw errors.badRequest(
          'cannot_invite_owner',
          'An organization has exactly one owner. Use ownership transfer instead.',
        );
      }
      if ((await repo.findMembership(orgId, userId)) !== undefined) {
        throw errors.conflict('already_a_member', 'That user is already a member.');
      }
      await repo.insertMember({ orgId, userId, role, invitedBy, at: now() });
    },

    async changeRole(orgId, userId, role) {
      const membership = await repo.findMembership(orgId, userId);
      if (membership === undefined) throw errors.notFound('not_a_member', 'That user is not a member.');
      if (membership.role === 'owner') {
        throw errors.badRequest(
          'cannot_demote_owner',
          'Transfer ownership before changing the owner’s role.',
        );
      }
      if (role === 'owner') {
        throw errors.badRequest(
          'cannot_promote_to_owner',
          'An organization has exactly one owner. Use ownership transfer instead.',
        );
      }
      await repo.updateMemberRole(orgId, userId, role, now());
    },

    async removeMember(orgId, userId) {
      const membership = await repo.findMembership(orgId, userId);
      if (membership === undefined) throw errors.notFound('not_a_member', 'That user is not a member.');
      if (membership.role === 'owner') {
        // An org with no owner has nobody who can delete it or transfer it,
        // which is a state with no exit.
        throw errors.badRequest(
          'cannot_remove_owner',
          'Transfer ownership before removing the owner.',
        );
      }
      await repo.deleteMember(orgId, userId);
    },

    async transferOwnership(orgId, fromUserId, toUserId) {
      const from = await repo.findMembership(orgId, fromUserId);
      if (from === undefined || from.role !== 'owner') {
        throw errors.forbidden('not_the_owner', 'Only the owner can transfer ownership.');
      }
      const to = await repo.findMembership(orgId, toUserId);
      if (to === undefined) {
        throw errors.badRequest(
          'not_a_member',
          'Ownership can only be transferred to an existing member.',
        );
      }
      if (fromUserId === toUserId) return;
      await repo.transferOwnership(orgId, fromUserId, toUserId, now());
    },

    async requireRole(orgId, userId, atLeast) {
      /*
       * The organization acting for itself.
       *
       * An API token owned by an org authenticates *as* the org, and an org has
       * never had a membership row for itself -- so such a token could do
       * nothing at all. That is the shape CI wants: a credential that does not
       * stop working when the person who made it leaves.
       *
       * **Organizations only.** `requireRole` is also called with an account
       * that turns out to be a user -- creating a product under your own handle
       * is the case -- and answering that one `owner` would let a caller past a
       * check that exists to stop it. It falls through to the membership lookup
       * and the `404` below, as it did before this branch existed.
       *
       * Otherwise reachable only by an API token: a session actor's account id
       * is a user account, and `requireSession` refuses a token outright, so
       * this grants nothing on the routes that administer an organization.
       */
      if (orgId === userId && (await repo.findAccountById(orgId))?.type === 'org') {
        return 'owner';
      }

      const membership = await repo.findMembership(orgId, userId);
      if (membership === undefined) {
        // 404 rather than 403: a non-member should not learn that an org exists
        // by being told they lack permission on it.
        throw errors.notFound('account_not_found', 'No such organization.');
      }
      if (!roleAtLeast(membership.role, atLeast)) {
        throw errors.forbidden(
          'insufficient_role',
          `This action needs the ${atLeast} role or higher.`,
          { held: membership.role, required: atLeast },
        );
      }
      return membership.role;
    },

    async orgSettings(orgId) {
      const settings = await repo.findOrgSettings(orgId);
      if (settings === undefined) {
        throw errors.notFound('org_settings_missing', 'That organization has no settings row.');
      }
      return settings;
    },
  };
}
