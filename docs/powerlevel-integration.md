# Powerlevel integration and deployed service changes

The actual dashboard was inspected at `/Users/michaelkhalil/Documents/ChatGPT/Gamify Gym`, with an existing client example at `/Users/michaelkhalil/Documents/ChatGPT/bulgarian powerlifter tracker`. No applicable `AGENTS.md` was present in these projects or the new workspace. The existing dashboard's navy/lime/gold design and canonical exercise identifiers were reused. No credentials, personal histories, account codes, or example workouts were copied.

## Existing contract and live status

The tracker is hosted on GitHub Pages at `https://lordofblackwood.github.io/smolov-sbd/`, alongside the user's other PWAs. Sites serves only the existing Powerlevel connector at `https://powerlevel-sync.micak27.chatgpt.site`; tracker installation and use do not require ChatGPT sign-in. The existing `sync.mjs` uses GET and PUT `/api/history/{source}` with the original `pl1_` connection code, a derived SHA-256 bearer, and device-side AES-256-GCM encryption with a random IV and source-bound authenticated data. The relay stores ciphertext in its existing R2 bucket under a second hash of the bearer. There is no additional login system or scoring service.

The original dashboard/relay supported only `bulgarian`, `accessory`, and `bodyweight`. The approved update now adds the independent `smolov` source under its advertised `smolov-v1` contract. Canonical SBD identifiers are `backSquat`, `benchPress`, and `deadlift`; no conventional/sumo or other deadlift-variant catalog was found. A different deadlift display name must not create a duplicate exercise. A variant remains local until its mapping is confirmed against the existing generic lift meaning.

The legacy service stores one whole snapshot per source and connection. Its README requires one writer per source; the latest writer replaces previous data. Using the Bulgarian source for Smolov would compete with Auto Bulgarian. The deployed independent source avoids that collision. The PWA saves completed/partial/skipped sessions locally and durably queues their immutable revisions before uploading to the selected connection. Unsupported, unauthenticated or ambiguous operations still report needs-attention honestly.

The tracker verifies the exact advertised independent source contract before every upload; it never writes to the Bulgarian slot. A valid locally saved connection code is account scope, not evidence that Smolov uploads work. Connection checks during pairing/reopen and the manual Check connection control use GET on the existing read endpoint; it does not upload and does not claim successful integration. A 404 means no snapshot exists in that namespace and cannot establish that a pasted code is the user's correct one.

## Source reused and evidence

The crypto/authentication client and bodyweight dependency in `src/integration/vendor` are unmodified copies of `Gamify Gym/public/shared/sync.mjs` and `bodyweight.mjs`. The copied `history.mjs` validator has the prepared source extension mirrored in the reviewable dashboard patch. The adapter never calls the vendor client's unconditional PUT function.

Actual read-only checks on October 14, 2026:

- Relay `/` returned its service name, version 1 and device-encryption notice.
- Unauthenticated GET `/api/history/bulgarian` returned 401 `Connection required`.
- CORS preflight from `http://localhost:5173` returned 403 `Origin not allowed`.
- Preflight from `https://lordofblackwood.github.io` returned 204, allowing GET/PUT/OPTIONS and Authorization/Content-Type, with ETag/X-Synced-At exposed.
- Sites metadata identified the existing public relay as `appgprj_6aa1bb0a625c819198f0cd4fd4611e17`, saved version 2 and live source commit `4a43bd279124a0fc2e1e9a147241bb5671f62aa5`.
- After the user authorized preparing existing-service changes, the exact private source was opened with the Sites helper into `/private/tmp/smolov-relay-review`, matching that commit. At that preparation stage, no push, save or deployment was performed; approved publication is recorded below.

No real connection code was read, no personal snapshot was fetched and no test/demo workout was written to a live account.

## Published existing-app changes

`integrations/relay.patch` applies to the actual relay source above. `integrations/powerlevel-dashboard.patch` applies to the existing Gamify Gym dashboard. Changed-file copies live beside these patches for review; they do not run a replacement relay. Preserve each existing repository's metadata, Site identity, existing R2 binding and deployment audience when applying them.

The deployed relay adds a separate `smolov` source and advertises the exact `smolov-v1` contract at its existing root. New-source PUT requires an exact `If-Match` ETag from the last source read, or `If-None-Match: *` when creating a missing source. The Worker passes that condition directly to the existing R2 atomic conditional write API. Missing conditions return 428; concurrent/stale writes return 412 without storing the payload. Legacy writers retain their original contract and source keys.

Conditional write behavior follows Cloudflare's [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) and [consistency model](https://developers.cloudflare.com/r2/reference/consistency/). The test storage implements those semantics in memory; live R2 concurrency was not tested with real workout writes.

The relay already allows `https://lordofblackwood.github.io`, the origin shared by the user's GitHub Pages PWAs. The original publication also added exactly `https://smolov-sbd.micak27.chatgpt.site` and named local dev/preview origins for localhost and 127.0.0.1. That previous tracker origin is retained as a migration fallback; arbitrary Sites origins remain rejected. The dashboard patch adds strict source validation, the connection row, source labels/history filter, and recognition of proven Smolov singles in its existing scoring path. It does not copy or change the strength/power formulas. The Smolov launcher now points to its GitHub Pages URL.

After the user explicitly approved publishing both existing-app updates, the relay was saved as Sites version 3 and deployed successfully on October 14, 2026. Its source commit is `0da8158cf3beb79ca4676412f47cab1663216a26`, deployment `appgdep_6acfd32bbe20819191fa516f3602de7b`, and existing public audience and R2 BUCKET binding are unchanged. The dashboard update was pushed to its existing main branch at `b7e8e22b897237eee3973d527f6a79bab54252b0`; its [Pages workflow](https://github.com/lordofblackwood/gamify-gym/actions/runs/38621123985) completed successfully. The live [dashboard](https://lordofblackwood.github.io/gamify-gym/) JavaScript and shared validator contain the approved Smolov source/contract. The new tracker's publication is separate from these two existing-app updates.

## Mapping, corrections and retries

`syncWorkout` receives the exact queued local revision, verifies that both the supplied code and immutable workout belong to the selected connection, then checks the relay's root capability. It will not discover or write a new source path until the service advertises its exact contract. Once supported, it reads/decrypts the current source, merges a whole session revision, and encrypts/PUTs only the independent source under a mandatory precondition.

Stable session/set identities are retained. A remotely present identical revision is acknowledged without another upload. A correction replaces that session's prior revision while preserving other sessions; removed sets are removed from that session's snapshot. A newer or conflicting same-number remote revision pauses for reconciliation. Failed authentication pauses. A lost write response triggers read-back of the exact revision; an unavailable or inconclusive confirmation pauses the outbox and never blindly repeats the write. Only transient failures before dispatch may automatically retry on reopen/reconnection.

Actual pounds are uploaded without loading-increment rounding; conversion uses exactly 1 lb = 0.45359237 kg. Original logged value/unit remain both local and in the prepared source. Targets remain local and separate from performed values. The training date derives from the actual start timestamp in America/New_York, each event date from its actual logging/activity timestamp, and the original program date remains separately preserved as `scheduledDate`, including across the November daylight-saving transition.

The new schema preserves session/set identities and revisions, actual timestamps, exercise, actual loading/reps, outcome, original unit/value, notes/discomfort, and set kind. RPE is optional and emitted only when recorded on designated calibration/final singles. Skips have null loading, zero completed reps and no strength/day credit. Warm-ups cannot become successful-single evidence. No multi-rep set is turned into a proven single, and the legacy constrained `repSet` field is not fabricated.

Program prescriptions, target snapshots, extra custom/accessory entries and meet-attempt controls remain local. The prepared schema permits meet-attempt evidence, but this workout adapter only dispatches saved workout sessions; meet attempts require a documented saved-session mapping before upload is enabled for them. No scores are returned by this relay. The tracker does not calculate or display fabricated Powerlevel scores; scoring remains in the dashboard.

## Verification

`tests/integration.test.ts` exercises the copied schema/crypto client, canonical identifiers, units, stable mapping, account separation and honest error states. `tests/service-extension.test.ts` runs the prepared real relay Worker against in-memory conditional storage, covering source gating, encrypted creation/update, corrections, retry/reload deduplication, stale revisions, actual outcomes, account isolation, response-loss reconciliation and DST. All requests are injected test fetchers; no tests contact a live account.

The relay's original and additional tests run with `npm test` inside `integrations/relay`. Review-time dashboard checks must be performed after applying the dashboard patch to its full existing repository; the changed-file directory is not a standalone dashboard. Live uploads and physical-device installation have not been verified.

Review verification completed: the 28 tracker integration/service/audit tests passed, all 15 prepared relay tests passed and its Worker build completed. Both patches pass `git apply --check` against their actual source bases. The full dashboard review copy passed all 113 tests and its PWA build; the build used Vite's `--configLoader runner` to avoid writing into dependencies symlinked from the original read-only repository. No live account uploads or platform device behavior were claimed by these checks.

Live read-only verification after publication confirmed the relay now advertises all four sources and `smolov-v1`, and its CORS preflight returns 204 for `https://smolov-sbd.micak27.chatgpt.site` with If-Match/If-None-Match allowed. Sites metadata confirms version 3 remains public. The dashboard Pages HTML references `/gamify-gym/assets/index-CcSYsddq.js`; that live bundle includes Smolov SBD, its contract and the tracker origin, and `/gamify-gym/shared/history.mjs` includes the source validator. No live workout uploads, personal-history reads or device-installation checks were used to verify publication.

The retained patches are review records against the pre-update relay/dashboard commits, not steps required to run the now-published apps. They are already applied in the published repositories. The original local Gamify Gym workspace was fast-forwarded to the published dashboard commit and remains clean, so future work starts from the deployed source without reapplying the patches.

## GitHub Pages hosting correction

The hosting correction changes the tracker location and the existing dashboard's Smolov launcher, while preserving the Sites connector's address, storage binding, source namespace and encryption contract. Read-only checks on October 14, 2026 confirmed the live connector returns 204 to a Smolov CORS preflight from `https://lordofblackwood.github.io`, allowing GET/PUT/OPTIONS and Authorization/Content-Type/If-Match/If-None-Match, with ETag and X-Synced-At exposed. Its root still advertises all four sources and `smolov-v1`. No connector redeployment is needed for the GitHub Pages origin.

The dashboard launcher correction was published at commit `e7cfdf8a29b53c1f98a0c4c697d2dd65c47af975`. Its [GitHub Pages workflow](https://github.com/lordofblackwood/gamify-gym/actions/runs/38623871835) completed successfully. Live HTML references `/gamify-gym/assets/index-DzEui2H0.js`; that bundle contains the GitHub Pages tracker URL, no previous Sites tracker URL, and the unchanged Sites connector endpoint. All 113 dashboard tests and its subpath PWA build passed before publication. The original local dashboard workspace was fast-forwarded to that commit and remains clean.

Browser verification accepted the dashboard's offered update, confirmed its Connect data screen contains the Smolov SBD row, and followed its tracker link to the GitHub Pages Today screen without a sign-in prompt. An existing tracker tab held the editing lock, so the verification tab correctly stayed read-only. No connection was created, no code was accessed, and no workout records were changed.

Browser storage belongs to its original origin. Any settings or workout records already saved at the previous tracker address must be exported there and imported into the GitHub Pages tracker. This hosting change does not transfer browser records automatically and does not read or write personal relay histories. Use the same Powerlevel connection code after migration.

The tracker itself is now live on [GitHub Pages](https://lordofblackwood.github.io/smolov-sbd/). The final [Pages deployment](https://github.com/lordofblackwood/smolov-sbd/actions/runs/38624309415) succeeded from source `749d8a5649ca0b4966afdfe4bda1ebcb371a65bc`. Live HTML, manifest, icons and worker returned HTTP200; manifest start/scope are `/smolov-sbd/`. The in-app browser rendered Today and Settings without a sign-in prompt or console errors. All85 automated tests and13 browser tests passed, including offline reopening and path-isolated caches.

The earlier private tracker Site is now an owner-only **recovery utility**, not a workout PWA. It was published as version2 at source `ce37ee9e7da31d00e00bef54e45ce48af85785b0`; original source history remains an ancestor. It only reads existing per-account IndexedDB records for download, never submits them or includes connection codes. Six isolated browser check groups verified exact import through the current tracker, freshest committed saves, no database creation when absent, preserved records/caches, and deferred worker retirement. The old app's explicit Update remains blocked during an active workout. No live personal records were read or written to publish or verify this utility.

To migrate records, open the recovery utility in the same browser or installed-app context that held them, export the correct account backup, then open Pages and pair the same Powerlevel code before importing a paired-account backup. Select preference restoration to carry training maxes/loading settings after its future-target preview. Install the Pages URL as the new PWA; an existing installed icon still belongs to the old origin.
