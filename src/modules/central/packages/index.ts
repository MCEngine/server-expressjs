import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../../db/schema.js';
import { iso, type Clock } from '../../../lib/clock.js';
import { uuidParam } from '../http.js';

export interface InstalledPackage {
  platform: string;
  project_id: string;
  version_id: string;
  version: string;
  file_name: string;
  installed_at: string;
}

/** Every query behind MCPackage's central record of installed packages. */
export interface CentralPackageRepository {
  list(serverId: string, platform?: string): Promise<InstalledPackage[]>;
  record(serverId: string, record: InstalledPackage, at: string): Promise<void>;
}

export function createCentralPackageRepository(db: Kysely<Database>): CentralPackageRepository {
  return {
    async list(serverId, platform) {
      let query = db.selectFrom('mcpackage_packages').selectAll().where('server_id', '=', serverId);
      if (platform !== undefined) query = query.where('platform', '=', platform);
      const rows = await query.orderBy('platform').orderBy('project_id').execute();
      return rows.map((r) => ({
        platform: r.platform,
        project_id: r.project_id,
        version_id: r.version_id,
        version: r.version,
        file_name: r.file_name,
        installed_at: r.installed_time,
      }));
    },

    record: (serverId, record, at) =>
      db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('mcpackage_packages')
          .where('server_id', '=', serverId)
          .where('platform', '=', record.platform)
          .where('project_id', '=', record.project_id)
          .execute();
        await trx
          .insertInto('mcpackage_packages')
          .values({
            server_id: serverId,
            platform: record.platform,
            project_id: record.project_id,
            version_id: record.version_id,
            version: record.version,
            file_name: record.file_name,
            installed_time: record.installed_at,
            updated_at: at,
          })
          .execute();
      }),
  };
}

const platform = z.string().trim().toLowerCase().pipe(z.string().min(1).max(32));

/**
 * MCPackage's record of what each game server installed, under
 * `/api/mcpackage`. A server is identified by the id MCPackage generates once
 * in its data folder, so two servers sharing this API keep separate records.
 */
export function createCentralPackageRouter(repo: CentralPackageRepository, clock: Clock): Router {
  const router = Router();

  router.get('/servers/:serverId/packages', async (req, res) => {
    const query = z.object({ platform: platform.optional() }).parse(req.query);
    res.json({ packages: await repo.list(uuidParam(req, 'serverId'), query.platform) });
  });

  // The project id travels in the body: a GitHub project is "owner/repo", which
  // a path segment cannot carry.
  router.put('/servers/:serverId/packages', async (req, res) => {
    const body = z
      .object({
        platform,
        project_id: z.string().min(1).max(255),
        version_id: z.string().max(255).default(''),
        version: z.string().max(255).default(''),
        file_name: z.string().max(255).default(''),
        installed_at: z.string().max(64).default(''),
      })
      .parse(req.body);
    await repo.record(uuidParam(req, 'serverId'), body, iso(clock.now()));
    res.status(204).end();
  });

  return router;
}
