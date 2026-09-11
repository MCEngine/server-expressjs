# Artifact Upload

[← Back to README](../../README.md)

This service accepts jar files from the internet and serves them to Minecraft servers that
will load them as code. If one line is worth keeping: **nothing a caller supplies ever
becomes part of a filesystem path, and nothing is decompressed to find out how big it is.**

## In this project

The upload path is `PUT /api/v1/products/:id/versions/:version`, in
[`src/modules/product/routes.ts`](../../src/modules/product/routes.ts). It reaches:

- [`src/http/multipart.ts`](../../src/http/multipart.ts) — reads the body, capping the file
  while streaming.
- [`src/modules/product/service.ts`](../../src/modules/product/service.ts) — `publish`,
  which orders the checks and owns the transaction.
- [`src/modules/product/jar.ts`](../../src/modules/product/jar.ts) — `inspectJar` and
  `safeFileName`.
- [`src/lib/zip.ts`](../../src/lib/zip.ts) — the central-directory reader.
- [`src/storage/index.ts`](../../src/storage/index.ts) — `generateStorageKey` and the disk
  driver.

Three properties hold across all of it, and each is a specific line rather than a principle:

**The storage key is generated, not derived.** `generateStorageKey()` returns a sharded
ULID. The uploaded filename is passed through `safeFileName` and stored in
`product_files.file_name` as *data* — it is echoed in a `Content-Disposition` header and
nowhere else. There is no code path that joins a caller-supplied string onto a path, which
is why path traversal is not a check here but an absence.

**Nothing is decompressed.** `readCentralDirectory` reads entry names and declared sizes
from the central directory. A zip bomb wins by being extracted; this never extracts.

**The quota check is the write.** `ProductRepository.publish` claims quota with a
conditional `UPDATE ... WHERE storage_used_bytes + ? <= storage_quota_bytes` and treats zero
updated rows as a refusal. A read-then-write would let two uploads racing on a nearly-full
quota both pass the read.

## Surfaces

### Upload

| File | Exposure | Guard |
|---|---|---|
| `src/http/multipart.ts` | Any caller with `artifact:write` | Cap enforced while streaming; the request fails rather than being silently truncated. One file, twenty fields, 128 KiB per field. |
| `src/modules/product/jar.ts` | The uploaded bytes | Magic bytes, then a central-directory parse, then entry-name and symlink checks, then entry-count, declared-size and ratio limits, then a descriptor matching the product's `kind`. |
| `src/lib/zip.ts` | The uploaded bytes | Reads only; every bounds check throws `ZipFormatError`, rendered as `422 not_a_jar`. |
| `src/modules/product/service.ts` | The publish transaction | The object is written before the transaction, so a failure leaves an unreferenced object rather than a row pointing at nothing; a refused publish deletes it. |
| `products.owner_org_id` | Product creation | Refused unless the account is of type `org` — the database cannot check it, so the service does. |

### Storage

| File | Exposure | Guard |
|---|---|---|
| `src/storage/index.ts` `pathFor` | Storage keys | The key must match the generated pattern, and the resolved path must stay under the root. Both are unreachable if the layer above is correct, which is the reason they are there. |
| `product_files.file_name` | Echoed in a header | `safeFileName` reduces to a basename and strips control characters, quotes and backslashes; the header value is quoted as well. |
| `product_files` (schema) | Direct SQL | `CHECK (file_name not like '%/%' and not like '%\%')` and `CHECK (size_bytes > 0)`. |

### Download

| File | Exposure | Guard |
|---|---|---|
| `GET .../download` | Anyone, for a public product | `X-Artifact-SHA256` and `X-Artifact-Size` are set, and the plugin verifies before writing. A private or unlisted product answers `404` to a caller who may not see it. |

## Verifying

| Check | How | Passing looks like |
|---|---|---|
| Every jar guard fires | `npx vitest run test/jar.test.ts` | 31 passing, including an escaping path, a backslash path, a symlink, a declared 4 GB expansion, and a mod jar sent as a plugin |
| A rejected upload stores nothing | `npx vitest run test/product.test.ts -t "stores nothing"` | Passing: no object, no row |
| The key is not derived from the filename | `npx vitest run test/product.test.ts -t "never derives"` | Passing: the key matches the generated pattern and does not contain the uploaded name |
| The quota holds | `npx vitest run test/product.test.ts -t quota` | `507`, and only the first object stored |
| No path is built from input | `grep -rn "join(.*file_name\|join(.*fileName" src/` | No matches |

## Escalate, do not decide

* Raising `MAX_UNCOMPRESSED_BYTES`, `MAX_ENTRIES` or `MAX_COMPRESSION_RATIO` because a real
  jar was refused. Bring the jar; the limit may well be wrong, but it is not a thing to
  loosen because something failed.
* Accepting an archive that has no descriptor for its product kind.
* Serving a stored object through any path the caller can influence.
* Any request to skip checksum verification, on either side.

## Not a finding here

* **"The zip-slip check is pointless because the service never extracts."** It is here
  because the panel might, and tooling downstream might. A guard that holds only while
  nobody downstream extracts is not a guard.
* **"`file_name` is attacker-controlled and is stored."** Deliberately. It is data, and its
  only use is a quoted header value. The thing that is never attacker-controlled is
  `storage_key`.
* **"Uploads are not virus-scanned."** True, and out of scope — this service does not claim
  a jar is safe to run, only that it is the exact jar its publisher uploaded, which is what
  the checksum establishes.

## Open

* **No rate limit is enforced yet.** `wiki/information/api-contract.md` specifies 30 uploads
  per hour per org and 600 downloads per hour per token; nothing implements them. Until it
  does, the quota is the only thing bounding upload volume, and there is nothing bounding
  download volume at all.
* **Artifacts are not signed.** The checksum proves a download was not altered in transit
  from this service; it does not prove the org uploaded it, so anyone who can write to
  storage can substitute a jar and the recorded digest with it. An org signing key, with the
  plugin verifying the signature rather than only the digest, would close that. It is the
  single highest-value addition to this page.
* **The disk driver is single-instance.** `createDiskStorage` writes to a local path, so two
  instances behind a load balancer do not see each other's objects. The `Storage` interface
  exists for an object-store driver; none is written.

## Summary

Path traversal is structurally absent rather than defended against: storage keys are
generated and no caller-supplied string reaches a path. Archive attacks are handled by
reading the central directory and never decompressing, with limits on entry count, declared
size and expansion ratio. Quota is claimed by a conditional update, so it is race-free. The
two real gaps are that nothing rate-limits uploads or downloads yet, and that artifacts are
not signed — which means integrity is guaranteed in transit but authenticity is not.
