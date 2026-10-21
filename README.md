# Smolov SBD · Training Cycles

A mobile-first, local-first PWA for **Modified Smolov Jr. — SBD Training Cycles**. Complete three training weeks, take seven full days off, then complete another three training weeks. The home screen always presents the next unfinished workout; no session has a calendar deadline or meet countdown. `src/domain/sequence.ts` builds the current sequence on top of the preserved legacy prescriptions in `src/domain/program.ts`.

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

## Calibration and saved progress

Calibration is optional when all three training maxes are already confirmed. Otherwise, perform one squat, bench, and deadlift single at RPE 6–8, in that order, or confirm a previously performed single in Settings. The actual successfully lifted weight becomes the TM only after explicit confirmation; no estimated 1RM is calculated.

Existing calibration snapshots, original dates, confirmed maxes, active workouts, completed workouts and outbox records stay unchanged. A started original split calibration keeps its remaining unstarted tests without repeating saved tests. Legacy volume-week records map read-only to Cycle 1 weeks 1–2. Weeks already started under the original pairings retain them; untouched weeks use the revised pairings below. Old peak/taper/meet results remain stored and backed up; they are outside the new training sequence. Any active saved workout can still be resumed and finished.

New sessions have a stable program position (`programSessionId`) and record the actual New York start date separately. More than one session can occur on the same date without overwriting another. Finishing a complete or partial session, or explicitly skipping it, advances the queue. Passing calendar days does not advance it. Program previews cannot start future sessions ahead of the queue.

## Training weeks and per-lift adjustments

Each of the six training weeks has these six workouts:

| Workout | First lift | Second lift |
| ------- | ---------- | ----------- |
| 1 | Deadlift 5×3 at 85% TM | — |
| 2 | Squat 3×6 at 70% TM | Bench 3×6 at 70% TM |
| 3 | Squat 4×5 at 75% TM | Bench 4×5 at 75% TM |
| 4 | Deadlift 3×6 at 70% TM | Bench 5×3 at 85% TM |
| 5 | Squat 4×4 at 80% TM | Bench 4×4 at 80% TM |
| 6 | Squat 5×3 at 85% TM | — |

Weekly prescribed reps remain 69 squat, 69 bench and 33 deadlift. Aim for six workouts per training week and rest between weeks. After the final Cycle 1 workout is finished or explicitly skipped, Cycle 2 remains unavailable for 168 hours. The recovery screen shows the remaining time; there are no fixed start/end dates for the overall plan.

Before each new, untouched week after Cycle 1 week 1, the app asks **separately for squat, bench and deadlift** how the previous week felt:

| Feeling | Change to that lift’s weekly offset |
| ------- | ----------------------------------- |
| Easy | +15 lb |
| Good | +10 lb |
| Decent | +5 lb |
| OK | 0 lb |
| Hard | −5 lb |

Adjustments accumulate from the previous week and continue into Cycle 2 after the recovery week. Every choice previews the first prescription’s resulting weight before confirmation. No default rating is selected. Confirmed TMs stay unchanged; a saved weekly review stores its three ratings, cumulative per-lift offsets and confirmation timestamp. Started weeks retain their own loading rules, including original +5 lb squat/bench offsets for an already-started legacy week 2.

Calculated pound targets round **up** to totals loadable with a 45 lb bar and 5 lb plates: 265, 275, 285 lb, and so on. For example, 270 becomes 275 lb. A weekly offset is added after percentage/increment rounding and before final plate rounding, so an offset change does not always equal the change in a loaded total. Kilogram targets convert the physical pound adjustment. Saved target snapshots and queued uploads are never recalculated.

## Use

- Start on Next workout. Confirm existing calibration results in Settings or log and confirm actual calibration singles.
- The Program view shows both cycles in order, each week’s prescriptions, saved targets and the recovery break. Future weeks await their per-lift check-in before displaying final weights.
- Log complete, failed or skipped sets. Failed reps are actual reps; skipped reps are zero. Planned snapshots remain separate from editable actual records. Undo, notes/discomfort and separate warm-ups remain available.
- Every logging action commits to account-scoped IndexedDB. Resume after reload and use the rest timer offline. One tab at a time owns editing; another tab can review history and retry ownership after the editor closes.
- TM changes and imported preferences preview unstarted prescriptions, without altering saved targets. JSON backups include weekly check-ins and pending uploads. Malformed, oversized and foreign-account backups are rejected; duplicate program positions and conflicting reviews retain the local record.

## Powerlevel

The existing dashboard at `Documents/ChatGPT/Gamify Gym` and Auto Bulgarian client's real contract were inspected first. This app reuses their `pl1_` pairing code, bearer derivation, device-side AES-GCM encryption and existing exercise IDs. It uses the same dark navy/lime design tokens and locally bundled Inter/Barlow Condensed fonts. It does not introduce accounts, store server secrets, reimplement scoring or display fabricated Powerlevel values.

The original relay only accepted Bulgarian/accessory/bodyweight snapshot namespaces. To keep Auto Bulgarian safe, a reviewed extension adds an independent Smolov namespace and conditional revision writes. The tracker checks that the exact capability is advertised before using it. Without that capability, it retains a blocked outbox and reports the missing source truthfully.

Use your existing Powerlevel connection code in Settings. No environment API key is needed. A connection remains scoped locally; switching connections loads its separate records/outbox. You may explicitly include unsynced unpaired workouts when pairing; account codes are excluded from exports. Connection codes are saved locally for reopening, just as required by the existing client workflow.

Finished sessions queue immutable revision snapshots **before** any upload. Offline/transient pre-dispatch failures retry on reopen/reconnection; authentication failures pause. Conditional conflicts and ambiguous writes pause for explicit retry/reconciliation. The adapter first reads and reconciles the exact session revision; it does not blindly retry ambiguous writes. Corrections replace a session revision without duplicating it or disturbing other source histories.

See [integration documentation](docs/powerlevel-integration.md) for the live deployment state, source evidence, schemas, preserved/unsupported fields, review patches and platform limits. Canonical deadlift is generic; variant detail stays in notes. No scoring results are returned by this relay, so scores remain in Powerlevel. Meet attempts and optional custom/accessory entries do not upload yet.

## Verification

Run `npm test`, `BASE_PATH=/smolov-sbd/ npm run build` and `BASE_PATH=/smolov-sbd/ TEST_BASE_PATH=/smolov-sbd/ npm run e2e` to check the deployed shape.

Unit tests cover the 36-session sequence, exact lift order/reps, independent and cumulative per-lift adjustments, review gates, exact 168-hour recovery, actual activity dates, legacy history/layout compatibility, plate rounding, snapshot integrity, storage/account separation, conservative backups, outbox revisions and sync reconciliation. The legacy meet-result helpers remain covered for saved data compatibility.

Production browser checks use isolated desktop and phone contexts, block external origins, and exercise weekly check-ins, next-workout progression, saved history, offline logging/reopen, actual-set editing, rest timers, backup restoration, account isolation and the recovery boundary. No synthetic workouts are submitted to live accounts. Physical-device installation and a real personal-account upload remain outside the automated checks.
