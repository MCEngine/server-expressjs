import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../errors.js';
import { pathParam } from '../../http/params.js';
import { actorOf, requireScope, requireSession } from '../auth/middleware.js';
import type { FleetService } from './service.js';
import type { InstalledPlugin, ServerRecord } from './repository.js';
import type { AuditService } from '../audit/index.js';

const platformSchema = z.enum(['spigot', 'paper', 'folia']);

const registerSchema = z.object({
  name: z.string().trim().min(1).max(64),
  serverUrl: z.string().url().max(2048).nullable().optional(),
});

const reportSchema = z.object({
  platform: platformSchema.optional(),
  mcVersion: z.string().trim().max(32).optional(),
  agentVersion: z.string().trim().max(32).optional(),
  plugins: z
    .array(
      z.object({
        pluginId: z.string().trim().min(1).max(64),
        version: z.string().trim().max(64).nullable(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
        productId: z.string().max(64).nullable().optional(),
      }),
    )
    .max(2000),
});

const outcomeSchema = z.object({
  pluginId: z.string().trim().min(1).max(64),
  state: z.enum(['installed', 'pending_update', 'pending_delete', 'failed']),
  error: z.string().max(2048).nullable().optional(),
});

/**
 * A server as its owner sees it.
 *
 * `server_key` is **never** here. It is returned exactly once, by registration,
 * and it is the credential the plugin's `config.yml` carries.
 */
function publicServer(server: ServerRecord): Record<string, unknown> {
  return {
    id: server.id,
    name: server.name,
    created_at: server.created_at,
    ...(server.server_url === null ? {} : { server_url: server.server_url }),
    ...(server.platform === null ? {} : { platform: server.platform }),
    ...(server.mc_version === null ? {} : { mc_version: server.mc_version }),
    ...(server.agent_version === null ? {} : { agent_version: server.agent_version }),
    ...(server.last_seen_at === null ? {} : { last_seen_at: server.last_seen_at }),
  };
}

/** An installed plugin, with the drift between what is and what should be. */
function publicPlugin(plugin: InstalledPlugin): Record<string, unknown> {
  return {
    plugin_id: plugin.plugin_id,
    state: plugin.state,
    installed_version: plugin.installed_version,
    desired_version: plugin.desired_version,
    drifted:
      plugin.desired_version !== null && plugin.desired_version !== plugin.installed_version,
    ...(plugin.product_id === null ? {} : { product_id: plugin.product_id }),
    ...(plugin.last_error === null ? {} : { last_error: plugin.last_error }),
  };
}

export function createFleetRouter(fleet: FleetService, audit: AuditService): Router {
  const router = Router();

  router.post('/fleet/servers', requireScope('fleet:write'), async (req, res) => {
    const actor = actorOf(req);
    const body = registerSchema.parse(req.body);
    const { server, serverKey } = await fleet.register({
      ownerAccountId: actor.accountId,
      name: body.name,
      ...(body.serverUrl === undefined ? {} : { serverUrl: body.serverUrl }),
    });

    await audit.record({
      actor,
      subjectType: 'server',
      subjectId: server.id,
      action: 'server.registered',
      metadata: { name: server.name },
      ip: req.ip,
    });

    // The only response that carries the server key.
    res.status(201).json({ ...publicServer(server), server_key: serverKey });
  });

  router.get('/fleet/servers', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const servers = await fleet.listServers(actor.accountId);
    res.json({ data: servers.map(publicServer) });
  });

  router.get('/fleet/servers/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    const plugins = await fleet.listPlugins(server.id);
    res.json({ ...publicServer(server), plugins: plugins.map(publicPlugin) });
  });

  router.patch('/fleet/servers/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const body = registerSchema.partial().parse(req.body);
    const server = await fleet.updateServer(pathParam(req, 'id'), actor.accountId, body);
    res.json(publicServer(server));
  });

  router.delete('/fleet/servers/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    await fleet.removeServer(pathParam(req, 'id'), actor.accountId);
    res.status(204).end();
  });

  /**
   * The plugin reports what is installed.
   *
   * A full replacement, not a patch: a plugin removed by hand disappears from
   * the report, and a patch would leave it in the table forever.
   */
  router.post('/fleet/servers/:id/plugins', requireScope('fleet:write'), async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    const body = reportSchema.parse(req.body);

    await fleet.reportInventory({
      serverId: server.id,
      plugins: body.plugins,
      ...(body.platform === undefined ? {} : { platform: body.platform }),
      ...(body.mcVersion === undefined ? {} : { mcVersion: body.mcVersion }),
      ...(body.agentVersion === undefined ? {} : { agentVersion: body.agentVersion }),
    });
    await audit.recordFleet({
      serverId: server.id,
      action: 'version_check',
      detail: { reported: body.plugins.length },
    });
    res.status(204).end();
  });

  router.put('/fleet/servers/:id/plugins/:pluginId', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    const body = z
      .object({
        version: z.string().trim().max(64).nullable(),
        product: z.string().min(1).max(64).nullable(),
      })
      .parse(req.body);

    if (body.version !== null && body.product === null) {
      throw errors.badRequest(
        'product_required',
        'Name the product this plugin comes from, so the server knows what to download.',
      );
    }

    const pluginId = pathParam(req, 'pluginId');
    await fleet.setDesiredVersion(server.id, pluginId, body.version, body.product);
    await audit.record({
      actor,
      subjectType: 'server',
      subjectId: server.id,
      action: 'server.desired_version_set',
      metadata: { plugin_id: pluginId, version: body.version },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.delete('/fleet/servers/:id/plugins/:pluginId', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    const pluginId = pathParam(req, 'pluginId');
    await fleet.markForDeletion(server.id, pluginId);
    await audit.record({
      actor,
      subjectType: 'server',
      subjectId: server.id,
      action: 'server.plugin_marked_for_deletion',
      metadata: { plugin_id: pluginId },
      ip: req.ip,
    });
    res.status(204).end();
  });

  /** The one route the plugin polls. */
  router.get('/fleet/servers/:id/desired', requireScope('fleet:read'), async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    res.json(await fleet.desiredState(server.id));
  });

  router.post('/fleet/servers/:id/events', requireScope('fleet:write'), async (req, res) => {
    const actor = actorOf(req);
    const server = await fleet.requireServer(pathParam(req, 'id'), actor.accountId);
    const body = outcomeSchema.parse(req.body);

    await fleet.reportOutcome(server.id, body.pluginId, body.state, body.error ?? null);
    await audit.recordFleet({
      serverId: server.id,
      action: body.state === 'failed' ? 'failed' : body.state === 'pending_delete' ? 'delete' : 'install',
      detail: { plugin_id: body.pluginId, state: body.state, error: body.error ?? null },
    });
    res.status(204).end();
  });

  return router;
}
