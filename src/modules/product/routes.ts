import { Router } from 'express';
import { z } from 'zod';
import { errors } from '../../errors.js';
import { pathParam } from '../../http/params.js';
import { jsonField, readMultipart } from '../../http/multipart.js';
import { actorOf, requireScope, requireSession } from '../auth/middleware.js';
import type { IdentityService } from '../identity/index.js';
import type { ProductService } from './service.js';
import type { Storage } from '../../storage/index.js';
import type { AuditService } from '../audit/index.js';
import type { FleetService } from '../fleet/index.js';
import type { FileRecord, ProductRecord, VersionRecord } from './repository.js';
import {
  channelSchema,
  compatibilitySchema,
  createProductSchema,
  productKindSchema,
  publishVersionSchema,
  slugSchema,
  updateProductSchema,
} from './validation.js';

/**
 * The public view of a product.
 *
 * `repo_url` is **omitted** when unset rather than sent as `null`: the panel's
 * rule is "show it only when set", and an absent key is harder to render by
 * accident than a null.
 */
function publicProduct(product: ProductRecord): Record<string, unknown> {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    summary: product.summary,
    kind: product.kind,
    visibility: product.visibility,
    owner_org_id: product.owner_org_id,
    downloads_count: product.downloads_count,
    created_at: product.created_at,
    updated_at: product.updated_at,
    ...(product.description === null ? {} : { description: product.description }),
    ...(product.repo_url === null ? {} : { repo_url: product.repo_url }),
    ...(product.homepage_url === null ? {} : { homepage_url: product.homepage_url }),
    ...(product.license === null ? {} : { license: product.license }),
  };
}

function publicVersion(
  version: VersionRecord,
  file: FileRecord | undefined,
  compatibility: readonly { platform: string; minecraft_version: string }[],
): Record<string, unknown> {
  return {
    version: version.version,
    channel: version.channel,
    is_latest: version.is_latest,
    published_at: version.published_at,
    compatibility: compatibility.map((c) => ({
      platform: c.platform,
      minecraft_version: c.minecraft_version,
    })),
    ...(version.changelog === null ? {} : { changelog: version.changelog }),
    ...(file === undefined
      ? {}
      : { file: { name: file.file_name, size_bytes: file.size_bytes, sha256: file.sha256 } }),
  };
}

export function createProductRouter(
  products: ProductService,
  identity: IdentityService,
  storage: Storage,
  audit: AuditService,
  fleet?: FleetService,
): Router {
  const router = Router();

  /** Throws unless the caller holds at least `role` in the product's org. */
  const assertRole = async (
    product: ProductRecord,
    callerId: string,
    role: 'admin' | 'maintainer',
  ): Promise<void> => {
    await identity.requireRole(product.owner_org_id, callerId, role);
  };

  /**
   * Resolves a product for a caller, hiding what they may not see.
   *
   * A private product answers 404 to a non-member — the same answer a product
   * that does not exist gives, so its existence is not discoverable.
   */
  const visibleProduct = async (idOrSlug: string, callerId?: string): Promise<ProductRecord> => {
    const product = await products.resolve(idOrSlug);
    if (product.visibility !== 'private') return product;
    if (callerId === undefined) throw errors.notFound('product_not_found', 'No such product.');
    try {
      await identity.requireRole(product.owner_org_id, callerId, 'member');
    } catch {
      throw errors.notFound('product_not_found', 'No such product.');
    }
    return product;
  };

  router.get('/products', async (req, res) => {
    const query = z
      .object({
        kind: productKindSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        cursor: z.string().max(64).optional(),
      })
      .parse(req.query);

    const found = await products.search(query);
    res.json({
      data: found.map(publicProduct),
      next_cursor: found.length === query.limit ? (found.at(-1)?.id ?? null) : null,
    });
  });

  router.post('/products', requireScope('product:write'), async (req, res) => {
    const actor = actorOf(req);
    const body = createProductSchema.parse(req.body);

    const org = await identity.getByHandle(body.orgHandle);
    await identity.requireRole(org.id, actor.accountId, 'maintainer');

    const product = await products.create({ ...body, orgId: org.id });
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: org.id,
      action: 'product.created',
      metadata: { product_id: product.id, slug: product.slug },
      ip: req.ip,
    });
    res.status(201).json(publicProduct(product));
  });

  router.get('/products/:id', async (req, res) => {
    const product = await visibleProduct(pathParam(req, 'id'), req.actor?.accountId);
    res.json(publicProduct(product));
  });

  router.patch('/products/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const product = await visibleProduct(pathParam(req, 'id'), actor.accountId);
    await assertRole(product, actor.accountId, 'maintainer');

    const patch = updateProductSchema.parse(req.body);
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns['name'] = patch.name;
    if (patch.summary !== undefined) columns['summary'] = patch.summary;
    if (patch.description !== undefined) columns['description'] = patch.description;
    if (patch.repoUrl !== undefined) columns['repo_url'] = patch.repoUrl;
    if (patch.homepageUrl !== undefined) columns['homepage_url'] = patch.homepageUrl;
    if (patch.license !== undefined) columns['license'] = patch.license;
    if (patch.visibility !== undefined) columns['visibility'] = patch.visibility;

    res.json(publicProduct(await products.update(product.id, columns)));
  });

  router.put('/products/:id/slug', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const product = await visibleProduct(pathParam(req, 'id'), actor.accountId);
    await assertRole(product, actor.accountId, 'admin');

    const { slug } = z.object({ slug: slugSchema }).parse(req.body);
    const renamed = await products.changeSlug(product.id, slug);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: product.owner_org_id,
      action: 'product.slug_changed',
      metadata: { product_id: product.id, from: product.slug, to: slug },
      ip: req.ip,
    });
    res.json(publicProduct(renamed));
  });

  router.delete('/products/:id', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const product = await visibleProduct(pathParam(req, 'id'), actor.accountId);
    await assertRole(product, actor.accountId, 'admin');

    // The body must repeat the slug. The panel's confirm dialog is a courtesy;
    // this is the guard that survives someone scripting against the API.
    const { slug } = z.object({ slug: z.string() }).parse(req.body);
    await products.remove(product.id, slug);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: product.owner_org_id,
      action: 'product.deleted',
      metadata: { product_id: product.id, slug: product.slug },
      ip: req.ip,
    });
    res.status(204).end();
  });

  router.get('/products/:id/versions', async (req, res) => {
    const product = await visibleProduct(pathParam(req, 'id'), req.actor?.accountId);
    const versions = await products.listVersions(product.id);
    res.json({
      data: await Promise.all(
        versions.map(async (v) =>
          publicVersion(
            v,
            await products.fileOf(v.id).catch(() => undefined),
            await products.compatibilityOf(v.id),
          ),
        ),
      ),
    });
  });

  router.get('/products/:id/versions/latest', async (req, res) => {
    const product = await visibleProduct(pathParam(req, 'id'), req.actor?.accountId);
    const channel = channelSchema.default('release').parse(req.query['channel'] ?? 'release');
    const version = await products.latest(product.id, channel);
    res.json(
      publicVersion(
        version,
        await products.fileOf(version.id).catch(() => undefined),
        await products.compatibilityOf(version.id),
      ),
    );
  });

  router.get('/products/:id/versions/:version', async (req, res) => {
    const product = await visibleProduct(pathParam(req, 'id'), req.actor?.accountId);
    const version = await products.requireVersion(product.id, pathParam(req, 'version'));
    res.json(
      publicVersion(
        version,
        await products.fileOf(version.id).catch(() => undefined),
        await products.compatibilityOf(version.id),
      ),
    );
  });

  /**
   * Publishing a version. The panel sends a session; CI sends a token with
   * `artifact:write`. The two paths differ only in `upload_source`.
   */
  router.post('/products/:id/versions', requireScope('artifact:write'), async (req, res) => {
    const actor = actorOf(req);
    const product = await visibleProduct(pathParam(req, 'id'), actor.accountId);
    await assertRole(product, actor.accountId, 'maintainer');

    const settings = await identity.orgSettings(product.owner_org_id);
    const { fields, file } = await readMultipart(req, settings.max_file_bytes);

    const body = publishVersionSchema.parse({
      version: fields['version'],
      channel: fields['channel'],
      changelog: fields['changelog'],
      compatibility: compatibilitySchema.optional().parse(jsonField(fields, 'compatibility')),
    });

    const version = await products.publish({
      productId: product.id,
      version: body.version,
      ...(body.channel === undefined ? {} : { channel: body.channel }),
      changelog: body.changelog,
      ...(body.compatibility === undefined ? {} : { compatibility: body.compatibility }),
      fileName: file.fileName,
      bytes: file.bytes,
      uploadedBy: actor.kind === 'session' ? actor.accountId : null,
      uploadSource: actor.kind === 'session' ? 'web' : 'ci',
    });

    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: product.owner_org_id,
      action: 'product.version_published',
      metadata: {
        product_id: product.id,
        version: version.version,
        source: actor.kind === 'session' ? 'web' : 'ci',
      },
      ip: req.ip,
    });

    res.status(201).json(
      publicVersion(
        version,
        await products.fileOf(version.id),
        await products.compatibilityOf(version.id),
      ),
    );
  });

  /**
   * Streams the jar.
   *
   * The checksum and the size go in headers as well as in the JSON version
   * payload, so a client streaming straight to disk can verify without a second
   * request — which is exactly what the plugin does before moving a file
   * anywhere the server will load from.
   */
  router.get('/products/:id/versions/:version/download', async (req, res) => {
    const product = await visibleProduct(pathParam(req, 'id'), req.actor?.accountId);

    // A public product downloads without a credential. Anything else needs a
    // token that may see it, which `visibleProduct` has already established.
    if (product.visibility !== 'public' && req.actor === undefined) {
      throw errors.unauthorized('artifact_read_required', 'This artifact needs a token to download.');
    }

    const version = await products.requireVersion(product.id, pathParam(req, 'version'));
    const file = await products.fileOf(version.id);

    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('X-Artifact-SHA256', file.sha256);
    res.setHeader('X-Artifact-Size', String(file.size_bytes));
    // The stored name is already a basename with control characters stripped,
    // and it is quoted here as well -- a header value is the one place it could
    // still do damage.
    res.setHeader('Content-Disposition', `attachment; filename="${file.file_name}"`);

    await products.recordDownload(product.id);

    // A download that names a server is fleet activity, and is recorded as such.
    // The id is used rather than the server key: a key is a credential, and a
    // URL ends up in access logs.
    const serverId = typeof req.query['server'] === 'string' ? req.query['server'] : undefined;
    if (serverId !== undefined && fleet !== undefined && req.actor !== undefined) {
      const server = await fleet
        .requireServer(serverId, req.actor.accountId)
        .catch(() => undefined);
      if (server !== undefined) {
        await audit.recordFleet({
          serverId: server.id,
          action: 'download',
          productId: product.id,
          versionId: version.id,
          bytesSent: file.size_bytes,
          detail: { version: version.version },
        });
      }
    }

    const stream = await storage.open(file.storage_key);
    stream.pipe(res);
  });

  router.delete('/products/:id/versions/:version', requireSession, async (req, res) => {
    const actor = actorOf(req);
    const product = await visibleProduct(pathParam(req, 'id'), actor.accountId);
    await assertRole(product, actor.accountId, 'maintainer');

    const removed = pathParam(req, 'version');
    await products.deleteVersion(product.id, removed);
    await audit.record({
      actor,
      subjectType: 'org',
      subjectId: product.owner_org_id,
      action: 'product.version_deleted',
      metadata: { product_id: product.id, version: removed },
      ip: req.ip,
    });
    res.status(204).end();
  });

  return router;
}
