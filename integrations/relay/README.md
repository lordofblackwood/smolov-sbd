# Powerlevel encrypted relay integration copy

This mirrors the user's existing Powerlevel Sites relay. The independent Smolov source was published on October 14, 2026; see the tracker integration document for deployment provenance. Preserve the existing Site ID, public audience, R2 BUCKET binding, encrypted envelopes, pairing credentials and source keys. The included hosting metadata contains no secrets.

Four exact source paths are supported by this prepared change: bulgarian, accessory, bodyweight, and the independently scoped smolov source. The new source advertises smolov-v1 at the existing root and requires an exact If-Match ETag or If-None-Match: * for every write. Conditions are enforced atomically by R2; conflicts return 412. Legacy writers retain their original behavior. Named tracker/dev origins are allowlisted; arbitrary origins remain rejected. Payloads and credentials are never logged.

The relay only accepts an encrypted 2 MB-limited envelope; schema validation occurs on devices because the relay does not have the decryption key. It has no listing endpoint. Keep the existing public audience for browser API reachability; individual histories still require their private credential and encryption key.

Authenticated Smolov reads also include `snapshotEtag` alongside the existing encrypted envelope. It is the exact strong version returned with that same R2 object, also supplied in the standard ETag header. The root advertises `etagTransport: "snapshot-body"`. This additive transport permits conditional updates when hosting intermediaries remove or weaken the response header. Clients use this exact tag for `If-Match`; they must never turn a weak tag into a strong one or invent a tag from the response. Missing or malformed storage metadata produces a recoverable read error. Stored envelopes and other sources do not gain this field.

Run `npm test` to validate the behavior and `npm run build` to produce the Worker bundle. Update the actual existing Site through its source workflow, retaining its hosting metadata and R2 binding. The adjacent patches are historical review records against the pre-extension source and should not be reapplied to the current deployment. Publishing the GitHub Pages tracker does not publish this relay.

Never test by writing example workouts to a live user connection. All included tests use in-memory storage and synthetic authentication. Production R2 concurrency, real account uploads and physical-device behavior have not been tested.
