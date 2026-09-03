# 31. Images live in a closed bucket, are served through the distribution, and are what their bytes say

Status: accepted
Date: 2026-09-02

## Context

The schema comment on `product_images.url` promised a plain CDN address the API returns
verbatim, and the media type a client declares is whatever the client chose.

## Options

- A closed bucket behind the same distribution, UUID keys, the type read from the bytes
  (chosen).
- A public bucket: a second host and an open listing.
- Signed URLs: they expire inside a cached page.

## Decision

A behaviour on `images/*` caches with CloudFront's optimized policy; the URL is
`https://<distribution>/images/products/<id>/<uuid>.<ext>` with a one-year immutable header,
and a replaced image is a new key. PNG, JPEG, GIF and WebP are read by signature, and
`multer` enforces 5 MiB while the body streams. An upload writes the object, then the row,
and removes the object if the row fails. A delete removes the row, then the object, and logs
`image.orphaned` if the object stays. `OBJECT_STORE` is a token the e2e suite replaces with a
map.

## Consequences

**Gives up:** a deleted image can be served from the edge for up to a day, because an
invalidation is a paid call. No resizing.

**Switch:** signed URLs when an image belongs to one person, an invalidation per delete when a
removed image must vanish now.
