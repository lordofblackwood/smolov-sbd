# Smolov SBD · Meet Prep

A mobile-first, local-first PWA for **Modified Smolov Jr. — SBD Meet Prep**, October 14–November 15, 2026. The exact supplied schedule is implemented in `src/domain/program.ts`; the meet date and America/New_York calendar do not shift when a workout is missed.

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

The `dist` output can also be served by a static HTTPS host; localhost is permitted for development. Do not use Sites publishing for this frontend. The earlier Sites URL is retained only for recovering any browser-local records created there. Export its JSON backup, then open the GitHub Pages tracker, pair the same Powerlevel code if previously paired, and import the backup. Cross-origin local data cannot move automatically. Backups exclude connection codes.

Keep a dedicated subpath/origin: the manifest, app assets and service-worker scope use the configured base. This service worker precaches only the app shell/assets, not authenticated API responses or connection credentials. An update waits for user action and is disabled while a workout is active or a local save is pending.

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

Final checks: 85 automated tests, type checking and production build pass; 13 production browser tests pass with one intentional desktop skip for the phone-only size test. The existing relay passed 15 tests, and the updated Powerlevel dashboard passed 113 tests/build before publication.

The automated suite covers the exact schedule/order/reps; half-up loading and Week 2 offsets; RPE restrictions; null default TMs; snapshot integrity; timezone/DST; actual logging/edit/undo/failure/skip; warm-ups; IndexedDB failure/reopen/account separation; conservative backups; rest timers; conditional sync/revisions/concurrent writers/authentication/ambiguous reconciliation; and mixed-unit meet totals.

Browser checks exercise the production UI on desktop and phones: calibration/TMs → workout → actual set edits, failed/skipped sets and undo → refresh/resume → timer recovery → offline finish → offline new-tab reopen → reconnect and honest sync state → backup duplicates/preferences → meet attempts. Test accounts/requests are isolated, and no successful live account upload is asserted.

Physical iPhone/Android installation, notification behavior (not required), and a real personal-account upload have not been tested. The existing R2 conditional-write semantics were tested using injected storage and checked against Cloudflare documentation; live workout writes were intentionally excluded.
