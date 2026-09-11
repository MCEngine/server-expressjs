import { Router } from 'express';
import { z } from 'zod';
import { pathParam } from '../../http/params.js';
import { requireScope } from '../auth/middleware.js';
import type { Storage } from '../../storage/index.js';
import type { SourceService } from './service.js';

const resolveSchema = z.object({
  sourceType: z.enum(['spigotmc', 'modrinth', 'hangar', 'github_release', 'direct_url']),
  sourceRef: z.string().trim().min(1).max(2048),
  kind: z.enum(['bukkit_plugin', 'mod_client', 'mod_server']).default('bukkit_plugin'),
  serverId: z.string().max(64).nullable().optional(),
});

/** The ceiling for anything mirrored, independent of any org's quota. */
const MAX_MIRROR_BYTES = 134_217_728; // 128 MiB

export function createSourceRouter(sources: SourceService, storage: Storage): Router {
  const router = Router();

  router.post('/sources/resolve', requireScope('artifact:read'), async (req, res) => {
    const body = resolveSchema.parse(req.body);
    const artifact = await sources.resolve({
      sourceType: body.sourceType,
      sourceRef: body.sourceRef,
      kind: body.kind,
      ...(body.serverId === undefined ? {} : { serverId: body.serverId }),
      maxBytes: MAX_MIRROR_BYTES,
    });
    res.status(201).json(artifact);
  });

  router.get('/sources/:id', requireScope('artifact:read'), async (req, res) => {
    const { artifact } = await sources.open(pathParam(req, 'id'));
    res.json(artifact);
  });

  router.get('/sources/:id/download', requireScope('artifact:read'), async (req, res) => {
    const { artifact, key } = await sources.open(pathParam(req, 'id'));

    // Identical headers to a catalogue download, so the plugin's verify step
    // does not have to know where a jar came from.
    res.setHeader('Content-Type', 'application/java-archive');
    res.setHeader('Content-Length', String(artifact.size_bytes));
    res.setHeader('X-Artifact-SHA256', artifact.sha256);
    res.setHeader('X-Artifact-Size', String(artifact.size_bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${artifact.file_name}"`);

    const stream = await storage.open(key);
    stream.pipe(res);
  });

  return router;
}
