# Prepared Powerlevel encrypted relay extension

This is a review copy of the user's existing Powerlevel relay, opened from its actual Sites repository at commit `4a43bd279124a0fc2e1e9a147241bb5671f62aa5`. It has not been pushed or deployed. It preserves the existing Site ID, R2 BUCKET binding, encrypted envelopes, pairing credentials and legacy source keys. The included hosting metadata contains no secrets.

Four exact source paths are supported by this prepared change: bulgarian, accessory, bodyweight, and the independently scoped smolov source. The new source advertises smolov-v1 at the existing root and requires an exact If-Match ETag or If-None-Match: * for every write. Conditions are enforced atomically by R2; conflicts return 412. Legacy writers retain their original behavior. Named tracker/dev origins are allowlisted; arbitrary origins remain rejected. Payloads and credentials are never logged.

The relay only accepts an encrypted 2 MB-limited envelope; schema validation occurs on devices because the relay does not have the decryption key. It has no listing endpoint. Keep the existing public audience for browser API reachability; individual histories still require their private credential and encryption key.

Run `npm test` to validate the original behavior and extension, and `npm run build` to produce the review Worker bundle. To apply the prepared changes, use ../relay.patch against the existing configured relay repository, retaining its hosting metadata and R2 binding. Apply ../powerlevel-dashboard.patch to the existing dashboard and run its checks. Publishing those existing applications is a separate approval step; building or publishing the new tracker does not publish this extension.

Never test by writing example workouts to a live user connection. All included tests use in-memory storage and synthetic authentication. Production R2 concurrency, real account uploads and physical-device behavior have not been tested.
