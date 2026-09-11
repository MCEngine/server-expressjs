import type { Kysely } from 'kysely';
import type { Database, AccountType, MembershipTier } from '../../db/schema.js';
import type { OrgRole } from './validation.js';

/**
 * Every read and write the identity module makes.
 *
 * Kept behind an interface so the service is testable against a fake and so a
 * second adapter — MongoDB, when it arrives — implements this rather than the
 * service being rewritten. Nothing here knows which SQL provider is running;
 * that lives in `src/db/`.
 */
export interface IdentityRepository {
  findAccountByHandle(handle: string): Promise<AccountRecord | undefined>;
  findAccountById(id: string): Promise<AccountRecord | undefined>;
  handleExists(handle: string): Promise<boolean>;
  emailExists(email: string): Promise<boolean>;

  insertAccount(input: InsertAccount): Promise<void>;
  updateProfile(accountId: string, patch: ProfilePatch, at: string): Promise<void>;
  replaceHandle(accountId: string, from: string, to: string, at: string, historyId: string): Promise<void>;

  listEmails(accountId: string): Promise<EmailRecord[]>;
  insertEmail(input: InsertEmail): Promise<void>;
  findEmail(id: string): Promise<EmailRecord | undefined>;
  setPrimaryEmail(accountId: string, emailId: string, at: string): Promise<void>;
  deleteEmail(id: string): Promise<void>;

  insertOrgSettings(input: InsertOrgSettings): Promise<void>;
  findOrgSettings(orgId: string): Promise<OrgSettingsRecord | undefined>;

  findMembership(orgId: string, userId: string): Promise<MemberRecord | undefined>;
  listMembers(orgId: string): Promise<MemberRecord[]>;
  listOrgsForUser(userId: string): Promise<MemberRecord[]>;
  insertMember(input: InsertMember): Promise<void>;
  updateMemberRole(orgId: string, userId: string, role: OrgRole, at: string): Promise<void>;
  deleteMember(orgId: string, userId: string): Promise<void>;
  transferOwnership(orgId: string, fromUserId: string, toUserId: string, at: string): Promise<void>;
}

export interface AccountRecord {
  id: string;
  type: AccountType;
  status: string;
  handle: string;
  display_name: string;
  handle_changed_at: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
}

export interface EmailRecord {
  id: string;
  account_id: string;
  email: string;
  is_primary: boolean;
  verified_at: string | null;
}

export interface MemberRecord {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
}

export interface OrgSettingsRecord {
  org_id: string;
  membership_tier: MembershipTier;
  storage_quota_bytes: number;
  storage_used_bytes: number;
  max_file_bytes: number;
}

export interface InsertAccount {
  id: string;
  type: AccountType;
  handle: string;
  displayName: string;
  at: string;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

export interface InsertEmail {
  id: string;
  accountId: string;
  email: string;
  isPrimary: boolean;
  verifiedAt: string | null;
  at: string;
}

export interface InsertOrgSettings {
  orgId: string;
  tier: MembershipTier;
  quotaBytes: number;
  maxFileBytes: number;
  at: string;
}

export interface InsertMember {
  orgId: string;
  userId: string;
  role: OrgRole;
  invitedBy: string | null;
  at: string;
}

const ACCOUNT_COLUMNS = [
  'accounts.id',
  'accounts.type',
  'accounts.status',
  'account_profiles.handle',
  'account_profiles.display_name',
  'account_profiles.handle_changed_at',
  'account_profiles.avatar_url',
  'account_profiles.bio',
  'accounts.created_at',
] as const;

export function createIdentityRepository(db: Kysely<Database>): IdentityRepository {
  const accountQuery = () =>
    db
      .selectFrom('accounts')
      .innerJoin('account_profiles', 'account_profiles.account_id', 'accounts.id')
      .select(ACCOUNT_COLUMNS);

  return {
    async findAccountByHandle(handle) {
      return (await accountQuery()
        .where('account_profiles.handle', '=', handle)
        .executeTakeFirst()) as AccountRecord | undefined;
    },

    async findAccountById(id) {
      return (await accountQuery()
        .where('accounts.id', '=', id)
        .executeTakeFirst()) as AccountRecord | undefined;
    },

    async handleExists(handle) {
      const row = await db
        .selectFrom('account_profiles')
        .select('account_id')
        .where('handle', '=', handle)
        .executeTakeFirst();
      return row !== undefined;
    },

    async emailExists(email) {
      const row = await db
        .selectFrom('account_emails')
        .select('id')
        .where('email', '=', email)
        .executeTakeFirst();
      return row !== undefined;
    },

    async insertAccount({ id, type, handle, displayName, at }) {
      // One transaction: an account without a profile has no handle, and the
      // handle is how everything else addresses it.
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('accounts')
          .values({ id, type, status: 'active', created_at: at, updated_at: at })
          .execute();
        await trx
          .insertInto('account_profiles')
          .values({
            account_id: id,
            handle,
            display_name: displayName,
            handle_changed_at: null,
            avatar_url: null,
            bio: null,
            created_at: at,
            updated_at: at,
          })
          .execute();
      });
    },

    async updateProfile(accountId, patch, at) {
      const values: Record<string, unknown> = { updated_at: at };
      if (patch.displayName !== undefined) values['display_name'] = patch.displayName;
      if (patch.bio !== undefined) values['bio'] = patch.bio;
      if (patch.avatarUrl !== undefined) values['avatar_url'] = patch.avatarUrl;

      await db
        .updateTable('account_profiles')
        .set(values as never)
        .where('account_id', '=', accountId)
        .execute();
    },

    async replaceHandle(accountId, from, to, at, historyId) {
      // The history row and the new handle land together, so a released handle
      // is never briefly unrecorded and re-registrable.
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('account_handle_history')
          .values({ id: historyId, account_id: accountId, handle: from, released_at: at })
          .execute();
        await trx
          .updateTable('account_profiles')
          .set({ handle: to, handle_changed_at: at, updated_at: at })
          .where('account_id', '=', accountId)
          .execute();
      });
    },

    async listEmails(accountId) {
      return (await db
        .selectFrom('account_emails')
        .select(['id', 'account_id', 'email', 'is_primary', 'verified_at'])
        .where('account_id', '=', accountId)
        .orderBy('created_at')
        .execute()) as EmailRecord[];
    },

    async insertEmail({ id, accountId, email, isPrimary, verifiedAt, at }) {
      await db
        .insertInto('account_emails')
        .values({
          id,
          account_id: accountId,
          email,
          is_primary: isPrimary,
          verified_at: verifiedAt,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },

    async findEmail(id) {
      return (await db
        .selectFrom('account_emails')
        .select(['id', 'account_id', 'email', 'is_primary', 'verified_at'])
        .where('id', '=', id)
        .executeTakeFirst()) as EmailRecord | undefined;
    },

    async setPrimaryEmail(accountId, emailId, at) {
      // Demote first, then promote. The partial unique index allows exactly one
      // primary per account, so doing it the other way round hits the constraint
      // rather than replacing the row.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('account_emails')
          .set({ is_primary: false, updated_at: at })
          .where('account_id', '=', accountId)
          .where('is_primary', '=', true)
          .execute();
        await trx
          .updateTable('account_emails')
          .set({ is_primary: true, updated_at: at })
          .where('id', '=', emailId)
          .execute();
      });
    },

    async deleteEmail(id) {
      await db.deleteFrom('account_emails').where('id', '=', id).execute();
    },

    async insertOrgSettings({ orgId, tier, quotaBytes, maxFileBytes, at }) {
      await db
        .insertInto('org_settings')
        .values({
          org_id: orgId,
          membership_tier: tier,
          storage_quota_bytes: quotaBytes,
          storage_used_bytes: 0,
          max_file_bytes: maxFileBytes,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },

    async findOrgSettings(orgId) {
      return (await db
        .selectFrom('org_settings')
        .select([
          'org_id',
          'membership_tier',
          'storage_quota_bytes',
          'storage_used_bytes',
          'max_file_bytes',
        ])
        .where('org_id', '=', orgId)
        .executeTakeFirst()) as OrgSettingsRecord | undefined;
    },

    async findMembership(orgId, userId) {
      return (await db
        .selectFrom('org_members')
        .select(['org_id', 'user_id', 'role', 'created_at'])
        .where('org_id', '=', orgId)
        .where('user_id', '=', userId)
        .executeTakeFirst()) as MemberRecord | undefined;
    },

    async listMembers(orgId) {
      return (await db
        .selectFrom('org_members')
        .select(['org_id', 'user_id', 'role', 'created_at'])
        .where('org_id', '=', orgId)
        .orderBy('created_at')
        .execute()) as MemberRecord[];
    },

    async listOrgsForUser(userId) {
      return (await db
        .selectFrom('org_members')
        .select(['org_id', 'user_id', 'role', 'created_at'])
        .where('user_id', '=', userId)
        .orderBy('created_at')
        .execute()) as MemberRecord[];
    },

    async insertMember({ orgId, userId, role, invitedBy, at }) {
      await db
        .insertInto('org_members')
        .values({
          org_id: orgId,
          user_id: userId,
          role,
          invited_by: invitedBy,
          created_at: at,
          updated_at: at,
        })
        .execute();
    },

    async updateMemberRole(orgId, userId, role, at) {
      await db
        .updateTable('org_members')
        .set({ role, updated_at: at })
        .where('org_id', '=', orgId)
        .where('user_id', '=', userId)
        .execute();
    },

    async deleteMember(orgId, userId) {
      await db
        .deleteFrom('org_members')
        .where('org_id', '=', orgId)
        .where('user_id', '=', userId)
        .execute();
    },

    async transferOwnership(orgId, fromUserId, toUserId, at) {
      // One transaction, demoting before promoting: the partial unique index
      // permits exactly one owner, so there is no instant with two -- and
      // because it is a transaction, no instant with none either.
      await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('org_members')
          .set({ role: 'admin', updated_at: at })
          .where('org_id', '=', orgId)
          .where('user_id', '=', fromUserId)
          .execute();
        await trx
          .updateTable('org_members')
          .set({ role: 'owner', updated_at: at })
          .where('org_id', '=', orgId)
          .where('user_id', '=', toUserId)
          .execute();
      });
    },
  };
}
