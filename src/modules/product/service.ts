import { errors } from '../../errors.js';
import { ulid } from '../../lib/ids.js';
import { addDays, daysBetween, iso, type Clock } from '../../lib/clock.js';
import { normalizeVersion } from '../../lib/version.js';
import type { ProductKind, ReleaseChannel, UploadSource } from '../../db/schema.js';
import type { IdentityService } from '../identity/index.js';
import type { Storage } from '../../storage/index.js';
import { inspectJar, safeFileName } from './jar.js';
import { isReservedSlug, SLUG_COOLDOWN_DAYS } from './validation.js';
import type {
  FileRecord,
  ProductRecord,
  ProductRepository,
  SearchInput,
  VersionRecord,
} from './repository.js';

export interface PublishRequest {
  productId: string;
  version: string;
  channel?: ReleaseChannel;
  changelog?: string | undefined;
  compatibility?: readonly { platform: string; minecraftVersion: string }[];
  fileName: string;
  bytes: Buffer;
  uploadedBy: string | null;
  uploadSource: UploadSource;
}

export interface ProductService {
  create(input: {
    slug: string;
    orgId: string;
    name: string;
    summary: string;
    description?: string | undefined;
    kind: ProductKind;
    repoUrl?: string | null | undefined;
    homepageUrl?: string | null | undefined;
    license?: string | null | undefined;
    visibility?: 'public' | 'unlisted' | 'private' | undefined;
  }): Promise<ProductRecord>;
  resolve(idOrSlug: string): Promise<ProductRecord>;
  update(productId: string, patch: Record<string, unknown>): Promise<ProductRecord>;
  changeSlug(productId: string, next: string): Promise<ProductRecord>;
  remove(productId: string, confirmationSlug: string): Promise<void>;
  search(input: SearchInput): Promise<ProductRecord[]>;

  listVersions(productId: string): Promise<VersionRecord[]>;
  requireVersion(productId: string, version: string): Promise<VersionRecord>;
  latest(productId: string, channel: ReleaseChannel): Promise<VersionRecord>;
  fileOf(versionId: string): Promise<FileRecord>;
  compatibilityOf(versionId: string): Promise<{ platform: string; minecraft_version: string }[]>;

  publish(input: PublishRequest): Promise<VersionRecord>;
  deleteVersion(productId: string, version: string): Promise<void>;
  recordDownload(productId: string): Promise<void>;
}

export function createProductService(
  repo: ProductRepository,
  identity: IdentityService,
  storage: Storage,
  clock: Clock,
): ProductService {
  const now = () => iso(clock.now());

  const require = async (productId: string): Promise<ProductRecord> => {
    const product = await repo.findById(productId);
    if (product === undefined) throw errors.notFound('product_not_found', 'No such product.');
    return product;
  };

  return {
    async create(input) {
      const org = await identity.requireAccount(input.orgId);
      // Only an org publishes. A user who wants to publish creates one -- this
      // is a domain rule, not a permission to relax for convenience.
      if (org.type !== 'org') {
        throw errors.badRequest(
          'user_cannot_publish',
          'Only an organization can own a product. Create one first.',
        );
      }
      if (isReservedSlug(input.slug)) {
        throw errors.conflict('product_slug_reserved', `The product id "${input.slug}" is reserved.`);
      }
      if (await repo.slugExists(input.slug)) {
        throw errors.conflict('product_slug_taken', `The product id "${input.slug}" is already in use.`);
      }

      const at = now();
      const id = ulid();
      await repo.insert({
        id,
        slug: input.slug,
        owner_org_id: input.orgId,
        name: input.name,
        summary: input.summary,
        description: input.description ?? null,
        kind: input.kind,
        repo_url: input.repoUrl ?? null,
        homepage_url: input.homepageUrl ?? null,
        license: input.license ?? null,
        visibility: input.visibility ?? 'public',
        slug_changed_at: null,
        created_at: at,
        updated_at: at,
        deleted_at: null,
      });
      return require(id);
    },

    async resolve(idOrSlug) {
      // The URL carries either, and both are unique across every org -- which is
      // the whole reason the slug is globally unique rather than org-scoped.
      const bySlug = await repo.findBySlug(idOrSlug);
      if (bySlug !== undefined) return bySlug;
      const byId = await repo.findById(idOrSlug);
      if (byId !== undefined) return byId;
      throw errors.notFound('product_not_found', 'No such product.');
    },

    async update(productId, patch) {
      await require(productId);
      await repo.update(productId, patch, now());
      return require(productId);
    },

    async changeSlug(productId, next) {
      const product = await require(productId);
      if (product.slug === next) return product;

      if (product.slug_changed_at !== null) {
        const last = new Date(product.slug_changed_at);
        const elapsed = daysBetween(last, clock.now());
        if (elapsed < SLUG_COOLDOWN_DAYS) {
          throw errors.conflict(
            'product_slug_cooldown',
            `This product's id was changed ${Math.floor(elapsed)} days ago and can be changed again in ${Math.ceil(SLUG_COOLDOWN_DAYS - elapsed)} days.`,
            {
              changed_at: product.slug_changed_at,
              available_at: iso(addDays(last, SLUG_COOLDOWN_DAYS)),
            },
          );
        }
      }

      if (isReservedSlug(next)) {
        throw errors.conflict('product_slug_reserved', `The product id "${next}" is reserved.`);
      }
      if (await repo.slugExists(next)) {
        throw errors.conflict('product_slug_taken', `The product id "${next}" is already in use.`);
      }

      await repo.replaceSlug(productId, product.slug, next, now(), ulid());
      return require(productId);
    },

    async remove(productId, confirmationSlug) {
      const product = await require(productId);
      // The panel's confirm dialog is a courtesy. This is the actual guard, and
      // it survives someone scripting against the API.
      if (confirmationSlug !== product.slug) {
        throw errors.badRequest(
          'confirmation_mismatch',
          'Repeat the product id exactly to confirm deletion.',
        );
      }
      await repo.softDelete(productId, now());
    },

    search: (input) => repo.search(input),

    listVersions: (productId) => repo.listVersions(productId),

    async requireVersion(productId, version) {
      const found = await repo.findVersion(productId, version);
      if (found === undefined) throw errors.notFound('version_not_found', 'No such version.');
      return found;
    },

    async latest(productId, channel) {
      const found = await repo.findLatest(productId, channel);
      if (found === undefined) {
        throw errors.notFound('version_not_found', `That product has no ${channel} version yet.`);
      }
      return found;
    },

    async fileOf(versionId) {
      const file = await repo.findFile(versionId);
      if (file === undefined) throw errors.notFound('file_not_found', 'That version has no file.');
      return file;
    },

    compatibilityOf: (versionId) => repo.listCompatibility(versionId),

    async publish(input) {
      const product = await require(input.productId);
      const settings = await identity.orgSettings(product.owner_org_id);

      // 1 and 3. The size ceiling, checked against what actually arrived. The
      // route also caps the stream while reading, so a hostile upload is cut
      // off rather than buffered to here first.
      if (input.bytes.length > settings.max_file_bytes) {
        throw errors.payloadTooLarge(
          'file_too_large',
          'That file is larger than this organization is allowed to upload.',
          { size_bytes: input.bytes.length, limit: settings.max_file_bytes },
        );
      }

      // 4 to 8. Magic bytes, zip parse, zip-slip, zip-bomb, descriptor match.
      inspectJar(input.bytes, product.kind);

      // The object is written before the transaction, because a failed
      // transaction leaving an unreferenced object is recoverable and a
      // committed row pointing at nothing is not.
      const stored = await storage.put(input.bytes);
      const versionId = ulid();

      const outcome = await repo.publish({
        versionId,
        productId: product.id,
        ownerOrgId: product.owner_org_id,
        version: input.version,
        versionNorm: normalizeVersion(input.version),
        channel: input.channel ?? 'release',
        changelog: input.changelog ?? null,
        fileName: safeFileName(input.fileName),
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        contentType: 'application/java-archive',
        uploadedBy: input.uploadedBy,
        uploadSource: input.uploadSource,
        compatibility: input.compatibility ?? [],
        at: now(),
      });

      if (outcome !== 'ok') {
        await storage.delete(stored.key);
        if (outcome === 'version_exists') {
          throw errors.conflict(
            'version_exists',
            `Version ${input.version} has already been published for this product.`,
          );
        }
        // 9. The quota, checked as part of the write rather than before it.
        throw errors.insufficientStorage(
          'quota_exceeded',
          'This organization has no room left for that upload.',
          { required_bytes: stored.sizeBytes, quota_bytes: settings.storage_quota_bytes },
        );
      }

      return this.requireVersion(product.id, input.version);
    },

    async deleteVersion(productId, version) {
      const product = await require(productId);
      const found = await this.requireVersion(productId, version);
      const file = await repo.findFile(found.id);

      await repo.deleteVersion(found.id, product.owner_org_id, file?.size_bytes ?? 0, now());
      if (file !== undefined) await storage.delete(file.storage_key);
    },

    recordDownload: (productId) => repo.incrementDownloads(productId),
  };
}
