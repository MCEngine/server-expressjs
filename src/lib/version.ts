const SEGMENT_WIDTH = 5;
const MAX_SEGMENTS = 4;

/**
 * Produces the sortable form of a version string, stored as
 * `product_versions.version_norm`.
 *
 * Compared as text, `1.9.0` sorts above `1.10.0` — so a plugin comparing
 * versions that way updates *backwards*. Zero-padding each numeric segment to a
 * fixed width makes a plain string comparison correct in all four databases
 * without depending on a dialect-specific semver function.
 *
 *   1.10.0        -> 00001.00010.00000.00000|
 *   1.9.0         -> 00001.00009.00000.00000|
 *   1.10.0-beta.1 -> 00001.00010.00000.00000|beta.1
 *
 * The `|` separates the release core from any pre-release suffix, and it sorts
 * below every base32 and alphanumeric character — so `1.10.0` (empty suffix,
 * nothing after the bar) orders below `1.10.0-beta.1`. That is the wrong way
 * round for semver, where a pre-release precedes its release, so `compareVersions`
 * corrects it rather than the encoding pretending to.
 */
export function normalizeVersion(version: string): string {
  const trimmed = version.trim().replace(/^v/i, '');
  const [core = '', ...rest] = trimmed.split('-');
  const suffix = rest.join('-');

  const segments = core.split('.').slice(0, MAX_SEGMENTS);
  const padded: string[] = [];
  for (let i = 0; i < MAX_SEGMENTS; i++) {
    const raw = segments[i] ?? '0';
    const numeric = Number.parseInt(raw, 10);
    const value = Number.isNaN(numeric) ? 0 : Math.min(numeric, 99999);
    padded.push(String(value).padStart(SEGMENT_WIDTH, '0'));
  }

  return `${padded.join('.')}|${suffix}`;
}

/** True when `version` looks like something this service can order. */
export function isVersionLike(version: string): boolean {
  return /^v?\d+(\.\d+)*(-[0-9A-Za-z.-]+)?$/.test(version.trim());
}

/**
 * Orders two versions: negative when `a` is older, positive when newer, zero
 * when equal.
 *
 * Pre-release handling follows semver: `1.0.0-beta` is *older* than `1.0.0`,
 * which is the opposite of how the normalized strings sort, so the release core
 * is compared first and the suffix decides only when the cores match.
 */
export function compareVersions(a: string, b: string): number {
  const [coreA = '', suffixA = ''] = normalizeVersion(a).split('|');
  const [coreB = '', suffixB = ''] = normalizeVersion(b).split('|');

  if (coreA !== coreB) return coreA < coreB ? -1 : 1;
  if (suffixA === suffixB) return 0;

  // An empty suffix is the released version, and it is newer than any
  // pre-release of the same core.
  if (suffixA === '') return 1;
  if (suffixB === '') return -1;
  return suffixA < suffixB ? -1 : 1;
}

/** True when `candidate` is strictly newer than `installed`. */
export function isNewerThan(candidate: string, installed: string): boolean {
  return compareVersions(candidate, installed) > 0;
}
