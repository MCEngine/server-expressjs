import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Whether an address belongs to a range that must never be fetched.
 *
 * This service fetches URLs on a caller's behalf, which is a server-side request
 * forgery primitive unless the destination is constrained. The ranges below are
 * the ones that reach something the caller could not reach themselves: loopback,
 * private networks, link-local (including the cloud metadata address), and the
 * various reserved blocks.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // Not an address at all: refuse rather than guess.
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, and 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? '';
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9')) return true; // link-local
  if (normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('ff')) return true; // multicast
  // An IPv4-mapped address is an IPv4 address wearing a hat.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1] !== undefined) return isPrivateIPv4(mapped[1]);
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

/**
 * Checks a URL is safe for this service to fetch.
 *
 * HTTPS only, a public hostname, and **every** address that hostname resolves
 * to must be public — a name with one public and one private answer is refused,
 * because which one a later connection picks is not something this check can
 * control.
 *
 * This narrows DNS rebinding rather than closing it: the name is resolved here
 * and again by the connection, and a record with a one-second TTL can differ
 * between the two. Closing it properly means resolving once and connecting to
 * the address, which needs a custom agent; noted in the module's `Open`.
 */
export async function assertFetchable(
  rawUrl: string,
  resolve: (host: string) => Promise<{ address: string }[]> = (host) =>
    lookup(host, { all: true }),
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('That is not a valid URL.');
  }

  if (url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only https URLs can be fetched.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new UnsafeUrlError('A URL carrying credentials will not be fetched.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(host) !== 0) {
    if (isPrivateAddress(host)) {
      throw new UnsafeUrlError('That address is not publicly routable.');
    }
    return url;
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('That host is not publicly routable.');
  }

  let addresses: { address: string }[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new UnsafeUrlError('That host could not be resolved.');
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError('That host resolves to no addresses.');
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new UnsafeUrlError('That host resolves to an address that is not publicly routable.');
    }
  }

  return url;
}
