# Fetching External Sources

[← Back to README](../../README.md)

`POST /api/v1/sources/resolve` makes this service fetch a URL a caller chose. That is a
server-side request forgery primitive unless the destination is constrained, because this
service can reach things the caller cannot — the cloud metadata endpoint, an internal
database, anything on the deployment's private network.

If one line is worth keeping: **the plugin never fetches from a third party, and this service
never fetches from a private address.**

## In this project

The path is `POST /api/v1/sources/resolve` in
[`src/modules/source/routes.ts`](../../src/modules/source/routes.ts), reaching
[`service.ts`](../../src/modules/source/service.ts) →
[`resolvers.ts`](../../src/modules/source/resolvers.ts) →
[`src/lib/net.ts`](../../src/lib/net.ts).

**Why the service fetches rather than redirecting.** Handing the plugin a third-party URL
would break the one rule the plugin relies on: it downloads only from a server it is
configured to trust, and only against a checksum that server declared. So this service
fetches, validates, stores, and serves the result with the same headers a catalogue download
has — and a mirrored jar goes through `inspectJar` exactly as an upload does, because a jar
is not more trustworthy for having come from a well-known host.

**Why each source type validates its reference.** A resolver builds a URL by interpolation.
Without a shape check, `spigotmc` with a ref of `../../admin` escapes the API path the
resolver was building. Each type therefore validates before it interpolates.

## Surfaces

| File | Exposure | Guard |
|---|---|---|
| `src/lib/net.ts` `assertFetchable` | Any caller with `artifact:read` | HTTPS only; no credentials in the URL; IP literals checked against the private ranges; `localhost`/`.internal` refused by name; the hostname resolved and **every** answer required to be public. |
| `src/lib/net.ts` `isPrivateAddress` | The resolved addresses | Loopback, RFC 1918, link-local (including `169.254.169.254`), CGNAT, benchmarking, multicast, IPv6 unique-local and link-local, and IPv4-mapped IPv6. Anything that is not an address at all is refused. |
| `src/modules/source/resolvers.ts` | `source_ref` | A per-type shape check before any interpolation. |
| `src/modules/source/service.ts` | The response body | `content-length` checked before reading, actual length after, `inspectJar` on the bytes, and a 30-second abort. |
| `src/modules/source/routes.ts` | The route | `artifact:read`, and a hard 128 MiB ceiling independent of any org quota. |

## Verifying

| Check | How | Passing looks like |
|---|---|---|
| Private ranges are refused | `npx vitest run test/source.test.ts -t isPrivateAddress` | Passing, including `169.254.169.254` and `::ffff:127.0.0.1` |
| A public name pointing at a private address is refused | `npx vitest run test/source.test.ts -t "resolves to a private"` | Passing |
| A mixed answer is refused | `npx vitest run test/source.test.ts -t "one public and one private"` | Passing |
| A reference cannot escape its API path | `npx vitest run test/source.test.ts -t smuggle` | Passing for all four typed sources |
| A source that lies about its length is still capped | `npx vitest run test/source.test.ts -t "lied about"` | `source_too_large` |

## Escalate, do not decide

* Allowing `http:`, or allowing an IP literal "just for testing".
* Adding a source type whose reference is interpolated without a shape check.
* Any request to skip `inspectJar` for a mirrored artifact because the host is trusted.

## Not a finding here

* **"The allowlist should be of hosts, not of address ranges."** A host allowlist would be
  stricter and is worth having; the range check is what makes the *general* case safe, and
  the two are not alternatives.
* **"The fetch has no retry."** Deliberate. A failed resolve is a client-visible `400`, and
  retrying a fetch the caller chose is a way to turn one request into several.

## Open

* **DNS rebinding is narrowed, not closed.** The hostname is resolved by `assertFetchable`
  and again by the connection, and a record with a one-second TTL can differ between the two.
  Closing it properly means resolving once and connecting to the address with a custom agent
  that pins it. Not done.
* **Redirects are not re-validated.** The injected fetcher follows redirects by default, and
  a redirect to a private address is not currently checked. The fix is a fetcher configured
  with `redirect: 'manual'` that re-runs `assertFetchable` on each hop.
* **Mirrored artifacts are held in memory.** `SourceService` keeps its index in a `Map`, so
  a restart loses it and two instances do not share it. `external_sources` records the
  reference but not the storage key.

## Summary

Outbound fetches are constrained to HTTPS on hosts whose every resolved address is publicly
routable, and each source type validates its reference before interpolating it into a URL.
Mirrored artifacts are fetched, checked and stored by this service so the plugin's trust
model stays intact. Two real gaps remain: redirects are not re-validated, and the resolve-then-connect
window means DNS rebinding is reduced rather than eliminated.
