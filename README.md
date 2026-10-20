# Smolov SBD · Meet Prep

A mobile-first, local-first PWA for **Modified Smolov Jr. — SBD Meet Prep**, October 14–November 15, 2026. The supplied schedule, including the approved Friday calibration and volume-week pairing revisions below, is implemented in `src/domain/program.ts`; the meet date and America/New_York calendar do not shift when a workout is missed.

## Run, test and build

Requires Node 22.12+ (Node 24 also supported).

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm run preview -- --port 4173
npm run e2e
```

Development serves localhost:5173. The preview serves the production app, including the service worker. Browser tests run at 127.0.0.1:4173 with isolated IndexedDB and external requests blocked. Install Playwright's Chromium using `npx playwright install chromium` if it is absent; `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chromium npm run e2e` uses an existing installation. No tests write workouts to live accounts.

The PWA is hosted on **GitHub Pages** at [lordofblackwood.github.io/smolov-sbd/](https://lordofblackwood.github.io/smolov-sbd/), with source in [lordofblackwood/smolov-sbd](https://github.com/lordofblackwood/smolov-sbd). The existing Sites service hosts only the encrypted Powerlevel connector. There is no ChatGPT sign-in requirement for the tracker itself.

The workflow in `.github/workflows/pages.yml` type-checks, tests, builds and deploys `main` through GitHub Actions. It obtains the actual Pages base path from `actions/configure-pages`, so the manifest, service worker, icons and assets stay inside the project subdirectory. Set the repository's Pages source to **GitHub Actions**. No application secrets are required in the repository or workflow. To rehearse the deployed subpath locally:

```sh
BASE_PATH=/smolov-sbd/ npm run build
BASE_PATH=/smolov-sbd/ npm run preview -- --port 4173
TEST_BASE_PATH=/smolov-sbd/ npm run e2e
```

The `dist` output can also be served by a static HTTPS host; localhost is permitted for development. Do not use Sites publishing for this frontend. The [earlier address](https://smolov-sbd.micak27.chatgpt.site/) now serves only a read-only recovery page for any browser-local records created there. Export its JSON backup, then open the GitHub Pages tracker, pair the same Powerlevel code if previously paired, and import the backup. Cross-origin local data cannot move automatically. Backups exclude connection codes.

Keep a dedicated subpath/origin: the manifest, app assets and service-worker scope use the configured base. This service worker precaches only the app shell/assets, not authenticated API responses or connection credentials. An update waits for user action and is disabled while a workout is active or a local save is pending.

## Friday calibration

All three calibration tests are on **Friday, October 16**, ordered squat, bench, then deadlift: one single each at RPE 6–8. October 14–15 and October 17–18 are recovery days. Volume week 1 still starts Monday, October 19, and the meet remains November 15.

The actual successfully lifted single remains the training max, confirmed explicitly without estimating a 1RM. Existing calibration snapshots, dates, confirmed maxes and outbox records are preserved. If calibration already began under the original schedule, unstarted calibration days retain the original schedule to avoid repeating tests; the Program screen explains this. Untouched calibration uses the Friday session.

## Volume-week pairings

The user's revised pairings apply to both volume weeks:

| Day       | First lift             | Second lift         |
| --------- | ---------------------- | ------------------- |
| Monday    | Deadlift 5×3 at 85% TM | —                   |
| Tuesday   | Squat 3×6 at 70% TM    | Bench 3×6 at 70% TM |
| Wednesday | Squat 4×5 at 75% TM    | Bench 4×5 at 75% TM |
| Thursday  | Deadlift 3×6 at 70% TM | Bench 5×3 at 85% TM |
| Friday    | Squat 4×4 at 80% TM    | Bench 4×4 at 80% TM |
| Saturday  | Squat 5×3 at 85% TM    | —                   |
| Sunday    | Rest                   | —                   |

Thursday takes the bench prescription from the heaviest squat day. Weekly reps remain 69 squat, 69 bench and 33 deadlift. Week 2 still adds 5 lb after rounding for squat/bench only; peak/taper percentages, sets and reps and the meet prescriptions are unchanged.

Calculated pound targets then round **up** to totals loadable with a 45 lb bar and 5 lb plates, without 2.5 lb plates: 265, 275, 285 lb, and so on. For example, 270 becomes 275 lb and 275 stays 275 lb. This final plate rounding follows the existing calculation increment and Week 2 offset, so adjacent prescriptions can share a loadable total. Kilogram calculations, confirmed training maxes, manually entered actual weights, saved workout targets and queued uploads stay unchanged.

The Program screen previews the future changed dates and calculated targets. Unstarted days in a volume week containing an original-layout target snapshot retain the original pairings, preventing duplicated moved work or silent changes to an active session. Saved days display their own original or revised targets, including after a backup import combines layouts. Untouched weeks use the revised pairings. Saved weights, actual sets, timestamps and outbox revisions remain intact.

## Use

- Start on Today. Initial calibration sessions require actual loading and achieved RPE; no confirmed TMs or example workouts are seeded.
- In Settings, enter a calibration single already performed, or log it during the calibration workout and explicitly confirm it as a TM. TMs are the actual lifted weights, not estimated maxes. Peak results do not change them.
- The Program view includes every phase and rest day, the exact lift order and working prescriptions, and future calculated weights. Volume weeks use six lifting days; peak/taper do not.
- Log complete, failed or skipped sets. Failed reps are actual reps; skipped reps are zero. Planned target snapshots remain separate from editable actual records. Undo, notes/discomfort and separate warm-ups are available.
- Every logging action commits to account-scoped IndexedDB. Saved status appears after commit. Resume after reload, and use the timestamp-based rest timer offline. One tab at a time owns editing to prevent stale tabs overwriting durable state; another tab can review history and retry ownership after the editor closes.
- TM changes and preference restoration from a backup preview future unstarted prescriptions; existing targets remain unchanged. JSON export/import rejects malformed, oversized and foreign-account backups, skips duplicates and preserves local conflicts.
- Meet day supplies three slots per lift, independent official units and good/no-lift/not-taken outcomes. The total stays unavailable until all three lifts have a successful attempt. Meet attempts are local and included in backups.

## Powerlevel

The existing dashboard at `Documents/ChatGPT/Gamify Gym` and Auto Bulgarian client's real contract were inspected first. This app reuses their `pl1_` pairing code, bearer derivation, device-side AES-GCM encryption and existing exercise IDs. It uses the same dark navy/lime design tokens and locally bundled Inter/Barlow Condensed fonts. It does not introduce accounts, store server secrets, reimplement scoring or display fabricated Powerlevel values.

The original relay only accepted Bulgarian/accessory/bodyweight snapshot namespaces. To keep Auto Bulgarian safe, a reviewed extension adds an independent Smolov namespace and conditional revision writes. The tracker checks that the exact capability is advertised before using it. Without that capability, it retains a blocked outbox and reports the missing source truthfully.

Use your existing Powerlevel connection code in Settings. No environment API key is needed. A connection remains scoped locally; switching connections loads its separate records/outbox. You may explicitly include unsynced unpaired workouts when pairing; account codes are excluded from exports. Connection codes are saved locally for reopening, just as required by the existing client workflow.

Finished sessions queue immutable revision snapshots **before** any upload. Offline/transient pre-dispatch failures retry on reopen/reconnection; authentication failures pause. Conditional conflicts and ambiguous writes pause for explicit retry/reconciliation. The adapter first reads and reconciles the exact session revision; it does not blindly retry ambiguous writes. Corrections replace a session revision without duplicating it or disturbing other source histories.

See [integration documentation](docs/powerlevel-integration.md) for the live deployment state, source evidence, schemas, preserved/unsupported fields, review patches and platform limits. Canonical deadlift is generic; variant detail stays in notes. No scoring results are returned by this relay, so scores remain in Powerlevel. Meet attempts and optional custom/accessory entries do not upload yet.

## Verification

Final checks: 115 automated tests, type checking and the Pages-path production build pass; 23 production browser tests pass with one intentional desktop skip for the phone-only size test. The existing relay passed 15 tests, and the updated Powerlevel dashboard passed 113 tests/build before publication.

The automated suite covers the exact schedule/order/reps; calculation increments, Week 2 offsets and final pound rounding without 2.5 lb plates; RPE restrictions; null default TMs; snapshot integrity; timezone/DST; actual logging/edit/undo/failure/skip; warm-ups; IndexedDB failure/reopen/account separation; conservative backups; rest timers; conditional sync/revisions/concurrent writers/authentication/ambiguous reconciliation; and mixed-unit meet totals.

Browser checks exercise the production UI on desktop and phones: calibration/TMs → workout → actual set edits, failed/skipped sets and undo → refresh/resume → timer recovery → offline finish → offline new-tab reopen → reconnect and honest sync state → backup duplicates/preferences → meet attempts. Test accounts/requests are isolated, and no successful live account upload is asserted.

Physical iPhone/Android installation, notification behavior (not required), and a real personal-account upload have not been tested. The existing R2 conditional-write semantics were tested using injected storage and checked against Cloudflare documentation; live workout writes were intentionally excluded.
