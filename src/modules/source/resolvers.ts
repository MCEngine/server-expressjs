import { errors } from '../../errors.js';
import type { SourceType } from '../../db/schema.js';

/** Where a mirrored artifact actually lives, once its reference is resolved. */
export interface ResolvedLocation {
  readonly url: string;
  readonly fileName: string;
}

/**
 * Turns a `(source_type, source_ref)` pair into a URL this service can fetch.
 *
 * Each resolver validates the shape of its reference **before** building a URL,
 * so a caller cannot smuggle a path or a host into one by supplying a `..` or a
 * `//` in what should be a numeric resource id.
 */
export type Resolver = (ref: string) => ResolvedLocation;

const NUMERIC = /^\d{1,12}$/;
const SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const GITHUB_REF = /^([A-Za-z0-9](?:[A-Za-z0-9._-]{0,38})?)\/([A-Za-z0-9._-]{1,100})@([A-Za-z0-9._-]{1,100})$/;

const RESOLVERS: Record<SourceType, Resolver> = {
  spigotmc(ref) {
    if (!NUMERIC.test(ref)) {
      throw errors.badRequest('invalid_source_ref', 'A SpigotMC reference is a numeric resource id.');
    }
    return {
      url: `https://api.spiget.org/v2/resources/${ref}/download`,
      fileName: `spigot-${ref}.jar`,
    };
  },

  modrinth(ref) {
    if (!SLUG.test(ref)) {
      throw errors.badRequest('invalid_source_ref', 'A Modrinth reference is a project slug or id.');
    }
    return { url: `https://api.modrinth.com/v2/project/${ref}/version`, fileName: `${ref}.jar` };
  },

  hangar(ref) {
    const [owner, slug] = ref.split('/');
    if (owner === undefined || slug === undefined || !SLUG.test(owner) || !SLUG.test(slug)) {
      throw errors.badRequest('invalid_source_ref', 'A Hangar reference is owner/slug.');
    }
    return {
      url: `https://hangar.papermc.io/api/v1/projects/${owner}/${slug}/latestrelease`,
      fileName: `${slug}.jar`,
    };
  },

  github_release(ref) {
    const match = GITHUB_REF.exec(ref);
    if (match === null) {
      throw errors.badRequest('invalid_source_ref', 'A GitHub reference is owner/repo@tag.');
    }
    const [, owner, repo, tag] = match;
    return {
      url: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
      fileName: `${repo}-${tag}.jar`,
    };
  },

  direct_url(ref) {
    // Not validated here beyond being a string: `assertFetchable` is what
    // decides whether a URL may be fetched, and duplicating half of that check
    // here would give two places to keep in step.
    const name = ref.split('?')[0]?.split('/').pop() ?? 'artifact.jar';
    return { url: ref, fileName: name.endsWith('.jar') ? name : 'artifact.jar' };
  },
};

export function resolveReference(type: SourceType, ref: string): ResolvedLocation {
  return RESOLVERS[type](ref);
}
