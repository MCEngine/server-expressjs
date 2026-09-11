---
name: memory-decisions-version-addressed-by-path
description: Why publishing writes to PUT /products/:id/versions/:version instead of POST to the collection, and why a version field in the body is refused rather than ignored.
---

# A version is addressed by its path

**Publishing is `PUT /api/v1/products/:id/versions/:version`.** It was
`POST /api/v1/products/:id/versions` with the version as a multipart field.

## The reason

`products.id` is **globally unique and opaque** — that is the point of the identity decision
taken in the plan, and it is why no route needs the owning organization in its path. Once the
product is fully addressed by one segment, `(product_id, version)` fully addresses a version.

The old shape did not use that. Three routes already addressed a version by path:

```
GET    /products/:id/versions/:version
GET    /products/:id/versions/:version/download
DELETE /products/:id/versions/:version
```

and the fourth — the one that creates it — posted to the collection and carried the version in
the body. So a publisher wrote to one address and read back from another, and the service had
two ways of naming the same resource depending on which verb you used.

Now the address is the same in all four, and the URL a CI job publishes to is the URL it can
hand to anyone as the permalink.

## Why `PUT` and not `POST`

`PUT` is the method for creating a resource at a URI the **client** chose; `POST` is for
submitting a payload to a resource that will decide where it goes. The client chooses the
version, so `PUT` is the accurate verb.

`PUT` is normally also a replace, and this one is not: **a published version is immutable**, so
re-publishing an existing one is `409 version_exists`. That is a deliberate policy rather than
an unimplemented half of the method — the checksum in a version payload is what every Minecraft
server verifies its download against, and a version whose bytes can change is a version that
checksum cannot describe. The API contract says so at the route, so a reader does not have to
infer it from a failure.

## Why a `version` field in the body is refused, not ignored

The path is the only source of the version. A multipart body that also carries a `version`
field is answered `400 version_in_body` even when the two agree.

Ignoring it silently is the worse failure: a CI script that sends `version=1.2.3` in the body
while its URL still says `1.2.2` — because someone updated one line and not the other — would
publish 1.2.2 and report success, and nothing downstream would ever flag it. Refusing outright
turns a silent mispublish into a build failure with a message that names the problem.

## What this costs

The route is a breaking change to the contract. Nothing has shipped — all repositories are at
`0.0.0` and the only two callers are `MCEngine/client-reactjs` and any CI job written against
the pre-release contract — so it is made now rather than carried. `MCEngine/plugin-manager` is
unaffected: it only downloads, and the download route already had this shape.
