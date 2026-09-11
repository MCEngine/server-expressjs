import { z } from 'zod';

/**
 * A handle names a user or an org, and both live in one namespace — so a URL
 * like `/@name` does not have to know which it is, and a user cannot take a
 * handle an org holds.
 *
 * Lowercase only, and the database carries a `CHECK` saying so as well: SQLite
 * and MySQL differ on whether a plain unique index is case-sensitive, so relying
 * on the index alone would make `Alice` and `alice` two accounts on some engines
 * and a conflict on others.
 */
export const handleSchema = z
  .string()
  .min(1)
  .max(39)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'A handle is lowercase letters, digits and hyphens, and cannot start or end with a hyphen.',
  )
  .refine((h) => !h.includes('--'), 'A handle cannot contain two hyphens in a row.');

/**
 * Names that would collide with a route or read as official.
 *
 * Checked before the database, so the reason returned is "reserved" rather than
 * a unique-constraint conflict that says nothing.
 */
const RESERVED = new Set([
  'about', 'account', 'accounts', 'admin', 'api', 'assets', 'auth', 'blog', 'dashboard',
  'docs', 'download', 'downloads', 'explore', 'fleet', 'health', 'help', 'home', 'login',
  'logout', 'mcengine', 'mcpluginmanager', 'me', 'new', 'null', 'org', 'orgs', 'product',
  'products', 'register', 'root', 'search', 'settings', 'setting', 'signin', 'signup',
  'sources', 'static', 'status', 'support', 'system', 'tokens', 'undefined', 'user', 'users',
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}

export const displayNameSchema = z.string().trim().min(1).max(64);
export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const orgRoleSchema = z.enum(['owner', 'admin', 'maintainer', 'member']);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/** Roles that may act on an org, most privileged first. */
const RANK: Record<OrgRole, number> = { owner: 4, admin: 3, maintainer: 2, member: 1 };

/** True when `held` is at least as privileged as `required`. */
export function roleAtLeast(held: OrgRole, required: OrgRole): boolean {
  return RANK[held] >= RANK[required];
}

export const createAccountSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema,
  email: emailSchema,
});

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: z.string().max(4096).nullable().optional(),
    avatarUrl: z.string().url().max(2048).nullable().optional(),
  })
  .strict();

export const createOrgSchema = z.object({
  handle: handleSchema,
  displayName: displayNameSchema,
});

/** Days a handle or a product slug is locked after it changes. */
export const HANDLE_COOLDOWN_DAYS = 30;
