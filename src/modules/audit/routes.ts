import { Router } from 'express';
import { z } from 'zod';
import { pathParam } from '../../http/params.js';
import { actorOf, requireSession } from '../auth/middleware.js';
import type { IdentityService } from '../identity/index.js';
import type { FleetService } from '../fleet/index.js';
import type { AuditRow, AuditService, FleetRow } from './service.js';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});

function publicAudit(row: AuditRow): Record<string, unknown> {
  return {
    id: row.id,
    action: row.action,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    created_at: row.created_at,
    // Which credential acted, without saying which token — the id alone is
    // enough for an owner to correlate with their token list.
    actor: row.actor_token_id !== null ? 'token' : row.actor_account_id !== null ? 'user' : 'system',
    ...(row.actor_account_id === null ? {} : { actor_account_id: row.actor_account_id }),
    ...(row.actor_token_id === null ? {} : { actor_token_id: row.actor_token_id }),
    ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as unknown }),
  };
}

function publicFleet(row: FleetRow): Record<string, unknown> {
  return {
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    ...(row.product_id === null ? {} : { product_id: row.product_id }),
    ...(row.bytes_sent === null ? {} : { bytes_sent: row.bytes_sent }),
    ...(row.detail === null ? {} : { detail: JSON.parse(row.detail) as unknown }),
  };
}

export function createAuditRouter(
  audit: AuditService,
  identity: IdentityService,
  fleet: FleetService,
): Router {
  const router = Router();

  /** An org's own audit trail. Members only, at admin. */
  router.get('/orgs/:handle/audit', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const org = await identity.getByHandle(pathParam(req, 'handle'));
    await identity.requireRole(org.id, actor.accountId, 'admin');

    const page = pageSchema.parse(req.query);
    const rows = await audit.read({ subjectType: 'org', subjectId: org.id, ...page });
    res.json({
      data: rows.map(publicAudit),
      next_cursor: rows.length === page.limit ? (rows.at(-1)?.id ?? null) : null,
    });
  });

  /** A caller's own trail across every subject. */
  router.get('/me/audit', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const page = pageSchema.parse(req.query);
    const rows = (await audit.read(page)).filter((r) => r.actor_account_id === actor.accountId);
    res.json({ data: rows.map(publicAudit), next_cursor: null });
  });

  /** What one server has been doing. Its owner only. */
  router.get('/fleet/servers/:id/events', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);

    const page = pageSchema.parse(req.query);
    const rows = await audit.readFleet(server.id, page.limit, page.cursor);
    res.json({
      data: rows.map(publicFleet),
      next_cursor: rows.length === page.limit ? (rows.at(-1)?.id ?? null) : null,
    });
  });

  return router;
}
