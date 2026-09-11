import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { freshDatabase, type TestDatabase } from './db-helpers.js';
import {
  createIdentityRepository,
  createIdentityService,
  type IdentityService,
} from '../src/modules/identity/index.js';
import { createApp } from '../src/app.js';
import { fixedClock, addDays, iso, type Clock } from '../src/lib/clock.js';
import { testConfig, recordingLogger } from './helpers.js';
import { ApiError } from '../src/errors.js';

const START = '2026-01-01T00:00:00.000Z';

/** Runs `run`, asserts it threw an ApiError, and returns it for further checks. */
async function caught(run: () => Promise<unknown>): Promise<ApiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected an ApiError, but nothing was thrown.');
}

/** Asserts `run` throws an ApiError carrying `code`, and optionally `status`. */
async function expectApiError(run: () => Promise<unknown>, code: string, status?: number) {
  const error = await caught(run);
  expect(error.code).toBe(code);
  if (status !== undefined) expect(error.status).toBe(status);
}

describe('identity', () => {
  let t: TestDatabase;
  let identity: IdentityService;
  let clock: Clock;
  let at: Date;

  const rebuild = () => {
    clock = { now: () => at };
    identity = createIdentityService(createIdentityRepository(t.db), clock);
  };

  beforeEach(async () => {
    t = await freshDatabase();
    at = new Date(START);
    rebuild();
  });

  afterEach(async () => {
    await t.destroy();
  });

  describe('creating a user', () => {
    it('creates the account, the profile and a primary email together', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'Alice',
        email: 'alice@example.com',
      });

      expect(user.type).toBe('user');
      expect(user.handle).toBe('alice');
      expect(user.handle_changed_at).toBeNull();

      const emails = await identity.listEmails(user.id);
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({ email: 'alice@example.com', is_primary: true });
      // Created, not verified: verification is a separate act.
      expect(emails[0]!.verified_at).toBeNull();
    });

    it('refuses a handle already in use', async () => {
      await identity.createUser({ handle: 'alice', displayName: 'A', email: 'a@example.com' });
      await expectApiError(
        () => identity.createUser({ handle: 'alice', displayName: 'B', email: 'b@example.com' }),
        'handle_taken',
        409,
      );
    });

    it('refuses a reserved handle before the database sees it', async () => {
      await expectApiError(
        () => identity.createUser({ handle: 'admin', displayName: 'A', email: 'a@example.com' }),
        'handle_reserved',
        409,
      );
      await expectApiError(
        () => identity.createUser({ handle: 'api', displayName: 'A', email: 'a@example.com' }),
        'handle_reserved',
      );
    });

    it('refuses an email already bound to another account', async () => {
      await identity.createUser({ handle: 'alice', displayName: 'A', email: 'shared@example.com' });
      await expectApiError(
        () => identity.createUser({ handle: 'bob', displayName: 'B', email: 'shared@example.com' }),
        'email_taken',
      );
    });

    it('shares one namespace with organizations', async () => {
      const owner = await identity.createUser({
        handle: 'owner',
        displayName: 'Owner',
        email: 'owner@example.com',
      });
      await identity.createOrg({ handle: 'acme', displayName: 'Acme', ownerUserId: owner.id });

      // A user cannot take a handle an org holds, which is the point of one
      // namespace: /acme has exactly one meaning.
      await expectApiError(
        () => identity.createUser({ handle: 'acme', displayName: 'X', email: 'x@example.com' }),
        'handle_taken',
      );
    });
  });

  describe('the handle cooldown', () => {
    it('allows the first change, since nothing has changed yet', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      const renamed = await identity.changeHandle(user.id, 'alicia');
      expect(renamed.handle).toBe('alicia');
      expect(renamed.handle_changed_at).toBe(START);
    });

    it('refuses a second change one day short of thirty', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      await identity.changeHandle(user.id, 'alicia');

      at = addDays(new Date(START), 29);
      rebuild();
      await expectApiError(() => identity.changeHandle(user.id, 'alix'), 'handle_cooldown', 409);
    });

    it('allows it one day past thirty, and says when in the meantime', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      await identity.changeHandle(user.id, 'alicia');

      at = addDays(new Date(START), 29);
      rebuild();
      const error = await caught(() => identity.changeHandle(user.id, 'alix'));
      expect(error.details).toMatchObject({
        changed_at: START,
        available_at: iso(addDays(new Date(START), 30)),
      });

      at = addDays(new Date(START), 31);
      rebuild();
      await expect(identity.changeHandle(user.id, 'alix')).resolves.toMatchObject({
        handle: 'alix',
      });
    });

    it('records the released handle so it is not instantly re-registrable', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      await identity.changeHandle(user.id, 'alicia');

      const history = await t.db.selectFrom('account_handle_history').selectAll().execute();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ account_id: user.id, handle: 'alice' });
    });

    it('is a no-op when the handle is unchanged, and does not start a cooldown', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      const same = await identity.changeHandle(user.id, 'alice');
      expect(same.handle_changed_at).toBeNull();
    });
  });

  describe('emails', () => {
    it('makes the first address primary and later ones not', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'first@example.com',
      });
      const second = await identity.addEmail(user.id, 'second@example.com');
      expect(second.is_primary).toBe(false);
    });

    it('refuses to promote an unverified address', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'first@example.com',
      });
      const second = await identity.addEmail(user.id, 'second@example.com');
      // Otherwise anyone who can add an address can redirect password resets.
      await expectApiError(() => identity.makePrimary(user.id, second.id), 'email_not_verified', 400);
    });

    it('moves primary across in one step once verified', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'first@example.com',
      });
      const second = await identity.addEmail(user.id, 'second@example.com');
      await t.db
        .updateTable('account_emails')
        .set({ verified_at: START })
        .where('id', '=', second.id)
        .execute();

      await identity.makePrimary(user.id, second.id);

      const emails = await identity.listEmails(user.id);
      expect(emails.filter((e) => e.is_primary)).toHaveLength(1);
      expect(emails.find((e) => e.is_primary)?.email).toBe('second@example.com');
    });

    it('refuses to remove the primary address', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'first@example.com',
      });
      const emails = await identity.listEmails(user.id);
      await expectApiError(() => identity.removeEmail(user.id, emails[0]!.id), 'email_is_primary');
    });

    it('will not touch an address belonging to someone else', async () => {
      const alice = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      const bob = await identity.createUser({
        handle: 'bob',
        displayName: 'B',
        email: 'b@example.com',
      });
      const bobsEmails = await identity.listEmails(bob.id);

      // 404 rather than 403, so the request cannot be used to discover that an
      // address exists on another account.
      await expectApiError(() => identity.removeEmail(alice.id, bobsEmails[0]!.id), 'email_not_found', 404);
    });
  });

  describe('organizations', () => {
    const seedOrg = async () => {
      const owner = await identity.createUser({
        handle: 'owner',
        displayName: 'Owner',
        email: 'owner@example.com',
      });
      const org = await identity.createOrg({
        handle: 'acme',
        displayName: 'Acme',
        ownerUserId: owner.id,
      });
      return { owner, org };
    };

    it('makes the creator the owner and gives the org free-tier settings', async () => {
      const { owner, org } = await seedOrg();
      expect(org.type).toBe('org');

      const members = await identity.listMembers(org.id);
      expect(members).toEqual([expect.objectContaining({ user_id: owner.id, role: 'owner' })]);

      const settings = await identity.orgSettings(org.id);
      expect(settings.membership_tier).toBe('free');
      expect(settings.storage_used_bytes).toBe(0);
      expect(settings.storage_quota_bytes).toBeGreaterThan(0);
    });

    it('refuses to invite a second owner', async () => {
      const { org } = await seedOrg();
      const other = await identity.createUser({
        handle: 'other',
        displayName: 'O',
        email: 'o@example.com',
      });
      await expectApiError(
        () => identity.addMember(org.id, other.id, 'owner', org.id),
        'cannot_invite_owner',
      );
    });

    it('refuses to promote an existing member to owner', async () => {
      const { owner, org } = await seedOrg();
      const other = await identity.createUser({
        handle: 'other',
        displayName: 'O',
        email: 'o@example.com',
      });
      await identity.addMember(org.id, other.id, 'admin', owner.id);
      await expectApiError(() => identity.changeRole(org.id, other.id, 'owner'), 'cannot_promote_to_owner');
    });

    it('refuses to remove the owner, which would leave the org with no exit', async () => {
      const { owner, org } = await seedOrg();
      await expectApiError(() => identity.removeMember(org.id, owner.id), 'cannot_remove_owner');
    });

    it('transfers ownership without ever having two owners or none', async () => {
      const { owner, org } = await seedOrg();
      const heir = await identity.createUser({
        handle: 'heir',
        displayName: 'H',
        email: 'h@example.com',
      });
      await identity.addMember(org.id, heir.id, 'admin', owner.id);

      await identity.transferOwnership(org.id, owner.id, heir.id);

      const members = await identity.listMembers(org.id);
      const owners = members.filter((m) => m.role === 'owner');
      expect(owners).toHaveLength(1);
      expect(owners[0]!.user_id).toBe(heir.id);
      expect(members.find((m) => m.user_id === owner.id)?.role).toBe('admin');
    });

    it('will only transfer ownership to an existing member', async () => {
      const { owner, org } = await seedOrg();
      const stranger = await identity.createUser({
        handle: 'stranger',
        displayName: 'S',
        email: 's@example.com',
      });
      await expectApiError(
        () => identity.transferOwnership(org.id, owner.id, stranger.id),
        'not_a_member',
      );
    });

    it('refuses an org owning another org', async () => {
      const { org } = await seedOrg();
      await expectApiError(
        () => identity.createOrg({ handle: 'sub', displayName: 'Sub', ownerUserId: org.id }),
        'invalid_owner',
      );
    });

    it('refuses a user as a member twice', async () => {
      const { owner, org } = await seedOrg();
      const other = await identity.createUser({
        handle: 'other',
        displayName: 'O',
        email: 'o@example.com',
      });
      await identity.addMember(org.id, other.id, 'member', owner.id);
      await expectApiError(
        () => identity.addMember(org.id, other.id, 'member', owner.id),
        'already_a_member',
      );
    });
  });

  describe('requireRole', () => {
    it('accepts a role at or above the bar and rejects one below', async () => {
      const owner = await identity.createUser({
        handle: 'owner',
        displayName: 'O',
        email: 'o@example.com',
      });
      const org = await identity.createOrg({
        handle: 'acme',
        displayName: 'Acme',
        ownerUserId: owner.id,
      });
      const member = await identity.createUser({
        handle: 'member',
        displayName: 'M',
        email: 'm@example.com',
      });
      await identity.addMember(org.id, member.id, 'member', owner.id);

      await expect(identity.requireRole(org.id, owner.id, 'admin')).resolves.toBe('owner');
      await expectApiError(
        () => identity.requireRole(org.id, member.id, 'maintainer'),
        'insufficient_role',
        403,
      );
    });

    it('returns 404 to a non-member, so an org is not discoverable by probing', async () => {
      const owner = await identity.createUser({
        handle: 'owner',
        displayName: 'O',
        email: 'o@example.com',
      });
      const org = await identity.createOrg({
        handle: 'acme',
        displayName: 'Acme',
        ownerUserId: owner.id,
      });
      const stranger = await identity.createUser({
        handle: 'stranger',
        displayName: 'S',
        email: 's@example.com',
      });
      await expectApiError(
        () => identity.requireRole(org.id, stranger.id, 'member'),
        'account_not_found',
        404,
      );
    });
  });

  describe('GET /api/v1/accounts/:handle', () => {
    const appFor = () =>
      createApp({
        config: testConfig(),
        logger: recordingLogger(),
        services: { identity },
      });

    it('returns the public view', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'Alice',
        email: 'alice@example.com',
      });
      const res = await request(appFor()).get('/api/v1/accounts/alice');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: user.id,
        type: 'user',
        handle: 'alice',
        display_name: 'Alice',
        created_at: START,
      });
    });

    it('never exposes an email address or a status', async () => {
      await identity.createUser({ handle: 'alice', displayName: 'A', email: 'secret@example.com' });
      const res = await request(appFor()).get('/api/v1/accounts/alice');
      expect(JSON.stringify(res.body)).not.toContain('secret@example.com');
      expect(res.body).not.toHaveProperty('status');
    });

    it('omits an unset field rather than sending null', async () => {
      const user = await identity.createUser({
        handle: 'alice',
        displayName: 'A',
        email: 'a@example.com',
      });
      await identity.updateProfile(user.id, { bio: 'Hello.' });

      const res = await request(appFor()).get('/api/v1/accounts/alice');
      expect(res.body.bio).toBe('Hello.');
      expect(res.body).not.toHaveProperty('avatar_url');
    });

    it('answers a malformed handle the same way as an unused one', async () => {
      const bad = await request(appFor()).get('/api/v1/accounts/Not__Valid');
      const missing = await request(appFor()).get('/api/v1/accounts/nobody');
      expect(bad.status).toBe(404);
      expect(bad.body).toEqual(missing.body);
    });

    it('serves an org through the same route as a user', async () => {
      const owner = await identity.createUser({
        handle: 'owner',
        displayName: 'O',
        email: 'o@example.com',
      });
      await identity.createOrg({ handle: 'acme', displayName: 'Acme', ownerUserId: owner.id });

      const res = await request(appFor()).get('/api/v1/accounts/acme');
      expect(res.status).toBe(200);
      expect(res.body.type).toBe('org');
    });
  });
});
