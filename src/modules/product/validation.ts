import { z } from 'zod';
import { isVersionLike } from '../../lib/version.js';

/**
 * A product slug is the `:product_id` in the URL, and it is unique across every
 * organization — so it follows the same shape rules as an account handle and is
 * checked against the same kind of reserved list.
 */
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'A product id is lowercase letters, digits and hyphens, and cannot start or end with a hyphen.',
  );

const RESERVED_SLUGS = new Set(['new', 'settings', 'setting', 'search', 'api', 'admin', 'null', 'undefined']);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

export const productKindSchema = z.enum(['bukkit_plugin', 'mod_client', 'mod_server']);
export const visibilitySchema = z.enum(['public', 'unlisted', 'private']);
export const channelSchema = z.enum(['release', 'beta', 'alpha']);
export const platformSchema = z.enum(['spigot', 'paper', 'folia', 'fabric', 'forge', 'neoforge']);

export const versionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isVersionLike, 'A version looks like 1.2.3, optionally with a -beta.1 suffix.');

export const createProductSchema = z.object({
  slug: slugSchema,
  orgHandle: z.string().min(1).max(39),
  name: z.string().trim().min(1).max(128),
  summary: z.string().trim().min(1).max(256),
  description: z.string().max(65536).optional(),
  kind: productKindSchema,
  repoUrl: z.string().url().max(2048).nullable().optional(),
  homepageUrl: z.string().url().max(2048).nullable().optional(),
  license: z.string().max(64).nullable().optional(),
  visibility: visibilitySchema.optional(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(1).max(128).optional(),
    summary: z.string().trim().min(1).max(256).optional(),
    description: z.string().max(65536).nullable().optional(),
    repoUrl: z.string().url().max(2048).nullable().optional(),
    homepageUrl: z.string().url().max(2048).nullable().optional(),
    license: z.string().max(64).nullable().optional(),
    visibility: visibilitySchema.optional(),
  })
  .strict();

export const compatibilitySchema = z.array(
  z.object({ platform: platformSchema, minecraftVersion: z.string().trim().min(1).max(32) }),
);

export const publishVersionSchema = z.object({
  version: versionSchema,
  channel: channelSchema.optional(),
  changelog: z.string().max(65536).optional(),
  compatibility: compatibilitySchema.optional(),
});

/** Days a product slug is locked after it changes. Same rule as an account handle. */
export const SLUG_COOLDOWN_DAYS = 30;
