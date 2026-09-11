import { Router } from 'express';
import { z } from 'zod';
import {
  createOrgSchema,
  emailSchema,
  handleSchema,
  orgRoleSchema,
  updateProfileSchema,
  type OrgRole,
} from './validation.js';
import { assertMayAdminister as mayAdminister } from './authorize.js';
import { errors } from '../../errors.js';
import { pathParam } from '../../http/params.js';
import { requireSession, actorOf } from '../auth/middleware.js';
import type { AccountRecord, EmailRecord } from './repository.js';
import type { IdentityService } from './service.js';
import type { AuditService } from '../audit/index.js';

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

/** An email address as its owner sees it. Nobody else ever sees one. */
function ownEmail(email: EmailRecord): Record<string, unknown> {
  return {
    id: email.id,
    email: email.email,
    is_primary: email.is_primary,
    verified: email.verified_at !== null,
  };
}

export function createIdentityRouter(identity: IdentityService, audit: AuditService): Router {
  const router = Router();

  /** Resolves `:handle` to an account, or 404s the same way for either reason. */
  const accountFrom = async (raw: string): Promise<AccountRecord> => {
    const parsed = handleSchema.safeParse(raw);
    if (!parsed.success) {
      // A malformed handle cannot name anything, so this is 404 rather than
      // 400 -- it says the same thing as a well-formed handle nobody holds.
      throw errors.notFound('account_not_found', 'No such account.');
    }
    return identity.getByHandle(parsed.data);
  };

  /**
   * Throws unless the caller may administer `account`.
   *
   * A user administers themselves. An org is administered by its members at the
   * required role, which `requireRole` answers with 404 for a non-member so an
   * org is not discoverable by probing.
   */
  // The rule itself lives in `authorize.ts`, because the token routes ask the
  // same question and asking it twice is how the two answers drift apart.
  const assertMayAdminister = (
    account: AccountRecord,
    callerId: string,
    role: OrgRole = 'admin',
  ): Promise<void> => mayAdminister(identity, account, callerId, role);

  router.get('/accounts/:handle', async (req, res) => {
    res.json(publicAccount(await accountFrom(pathParam(req, 'handle'))));
  });

  router.get('/me', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const account = await identity.requireAccount(actor.accountId);
    res.json(publicAccount(account));
  });

  router.patch('/accounts/:handle', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const account = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(account, actor.accountId);

    const patch = updateProfileSchema.parse(req.body);
    res.json(publicAccount(await identity.updateProfile(account.id, patch)));
  });

  router.put('/accounts/:handle/handle', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const account = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(account, actor.accountId);

    const { handle } = z.object({ handle: handleSchema }).parse(req.body);
    const updated = await identity.changeHandle(account.id, handle);
    await audit.record({
      actor: req.actor,
      subjectType: account.type === 'org' ? 'org' : 'account',
      subjectId: account.id,
      action: 'account.handle_changed',
      metadata: { from: account.handle, to: handle },
      ip: req.ip,
    });
    res.json(publicAccount(updated));
  });

  /**
   * The organizations the caller belongs to.
   *
   * Under `/me` rather than `/orgs`, because it is a fact about the caller
   * rather than a listing of organizations — there is no route that lists
   * organizations, and this one must never become it.
   *
   * The role rides along: the panel decides what to offer from it, and asking
   * per organization would be a request each.
   */
  router.get('/me/orgs', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const memberships = await identity.listOrgsForUser(actor.accountId);
    res.json({
      data: await Promise.all(
        memberships.map(async (m) => {
          const org = await identity.requireAccount(m.org_id);
          return { role: m.role, joined_at: m.created_at, org: publicAccount(org) };
        }),
      ),
    });
  });

  router.get('/me/emails', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const emails = await identity.listEmails(actor.accountId);
    res.json({ data: emails.map(ownEmail) });
  });

  router.post('/me/emails', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const { email } = z.object({ email: emailSchema }).parse(req.body);
    res.status(201).json(ownEmail(await identity.addEmail(actor.accountId, email)));
  });

  router.post('/me/emails/:id/primary', requireSession, async (req, res) => {
    const actor = actorOf(req);
    await identity.makePrimary(actor.accountId, pathParam(req, 'id'));
    res.status(204).end();
  });

  router.delete('/me/emails/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    await identity.removeEmail(actor.accountId, pathParam(req, 'id'));
    res.status(204).end();
  });

  router.post('/orgs', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const body = createOrgSchema.parse(req.body);
    const org = await identity.createOrg({ ...body, ownerUserId: actor.accountId });
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'org.created',
      metadata: { handle: org.handle },
      ip: req.ip,
    });
    res.status(201).json(publicAccount(org));
  });

  router.get('/orgs/:handle/members', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(org, actor.accountId, 'member');

    const members = await identity.listMembers(org.id);
    res.json({
      data: await Promise.all(
        members.map(async (m) => {
          const account = await identity.requireAccount(m.user_id);
          return { role: m.role, joined_at: m.created_at, user: publicAccount(account) };
        }),
      ),
    });
  });

  router.post('/orgs/:handle/members', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(org, actor.accountId);

    const body = z.object({ handle: handleSchema, role: orgRoleSchema }).parse(req.body);
    const user = await identity.getByHandle(body.handle);
    await identity.addMember(org.id, user.id, body.role, actor.accountId);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'org.member_added',
      metadata: { user: user.handle, role: body.role },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.patch('/orgs/:handle/members/:userHandle', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(org, actor.accountId);

    const { role } = z.object({ role: orgRoleSchema }).parse(req.body);
    const user = await accountFrom(pathParam(req, 'userHandle'));
    await identity.changeRole(org.id, user.id, role);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'org.member_role_changed',
      metadata: { user: user.handle, role },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.delete('/orgs/:handle/members/:userHandle', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(org, actor.accountId);

    const user = await accountFrom(pathParam(req, 'userHandle'));
    await identity.removeMember(org.id, user.id);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'org.member_removed',
      metadata: { user: user.handle },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.post('/orgs/:handle/transfer', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));

    // Only the owner, and `transferOwnership` checks that too -- this is the
    // cheap check that keeps a non-member from learning the org exists.
    await identity.requireRole(org.id, actor.accountId, 'owner');

    const { handle } = z.object({ handle: handleSchema }).parse(req.body);
    const heir = await identity.getByHandle(handle);
    await identity.transferOwnership(org.id, actor.accountId, heir.id);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'org.ownership_transferred',
      metadata: { to: heir.handle },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.get('/orgs/:handle/settings', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await accountFrom(pathParam(req, 'handle'));
    await assertMayAdminister(org, actor.accountId);

    const settings = await identity.orgSettings(org.id);
    res.json({
      membership_tier: settings.membership_tier,
      storage_quota_bytes: settings.storage_quota_bytes,
      storage_used_bytes: settings.storage_used_bytes,
      max_file_bytes: settings.max_file_bytes,
    });
  });

  return router;
}
