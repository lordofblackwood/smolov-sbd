# Design and browser verification

The concept is the complete two-screen phone mockup `exec-9ab2df22-b546-48c4-80a4-304d6f09c16e.png`, generated in this chat before frontend coding. It remains a design reference outside the application bundle. The product follows the real Powerlevel design specification read from `Gamify Gym/docs/design.md`.

## Design system

Navy canvas #080c16; panels #0b111c; borders #243044; text #f4f5fc; muted text #a4b5d5; lime #d7fb79; violet #c1a0ff; gold #f8d375. Inter serves body text and controls; Barlow Condensed serves headings, loading and timer numbers. Fonts are bundled for offline use. Panels use 12px corners; mobile gutters are 20px. Controls use 44px or larger touch targets, visible keyboard focus and semantic labels. Outline icons use a consistent 1.7px stroke. Navigation is fixed with safe-area padding on phones and a 216px rail on desktop.

The primary screen preserves brand/date → training heading and phase → five-phase timeline → ordered lifts and prescriptions → clear workout action → Powerlevel status → Today/Program/History/Settings. The active screen preserves separate targets/actual inputs, only designated-single RPE, complete/failed/skip outcomes, optional notes/warm-ups, timer and finish action. The first unlogged working set gains a lime edge to make the next action visible. Program, History, Settings and Meet extend the same system using lists and readable forms.

## Intentional functional corrections to the raster concept

The image generator incorrectly shifted several program dates. The actual implementation follows the user's exact dates: calibration Oct14–18, volume1 Oct19–25, volume2 Oct26–Nov1, peak Nov2–8, taper Nov9–14, meet Nov15. It contains no seeded maxes, history, power scores or statistics. The concept's redundant outer frame and individual nested lift frames are simplified to one prescribed lift panel on a real phone, preserving hierarchy. The conceptual progress ring is replaced by a thin linear meter with exact logged-set/completed-rep numbers. Required skip, notes/discomfort, history corrections, offline states, backup previews, account controls and competing-tab protection are functional additions. Desktop uses the existing Powerlevel sidebar convention.

## Verification method

The Codex in-app browser loaded the production preview, checked the full schedule/navigation and reported a clean console. Its responsive DOM reported the requested phone dimensions, but its screenshot capture returned a scaled window image; readable screenshot evidence and repeatable offline/multi-tab checks therefore use Playwright Chromium. The separate Browser plugin/skill was not available. Playwright runs isolated storage with external origins blocked and synthetic test TMs only in test contexts. No live personal-account workouts are submitted.

The primary phone comparison is at 430×932 CSS pixels against the two-screen concept's phone composition, with additional 360px/390px checks and a 1440×1000 desktop check. The generated raster's combined1536×1024 board includes two phone screens; forcing the entire board width onto one phone would not represent its intended layout. `view_image` directly inspects the concept and the final actual phone screenshots.

Final automated results:85 unit/integration/storage tests and11 production browser tests passed. The one desktop skip is the phone-only430/360 size test. The in-app browser navigation and console checks passed.

## Fidelity ledger

| Comparison | Implementation evidence |
| --- | --- |
| Copy and order | Brand, Today heading, calibration, squat/bench order, target RPE6–8, Start workout and four nav items are preserved. Only the necessary date corrections and functional additions above differ. |
| Palette | Exact navy canvas and outlined panels; violet calibration and lime actions; no imagery or tint overlays. Stable screenshot capture disables the introductory fade during comparison. |
| Typography | Locally bundled Inter and Barlow Condensed; readable condensed headings/numbers and consistent labeled controls. |
| Spacing/containers |20px phone gutters,12px panel corners, compact open timeline and ordered lift rows; fewer nested frames for practical phone width. |
| Icons/navigation | Same barbell mark and outline control language; four fixed phone tabs and existing-style desktop rail. |
| Logging state | Actual loading/reps stay separate from snapshots; only calibration/final singles offer RPE. Complete/failed/skipped outcomes remain visually distinct. |
| Responsive/interaction | Phone/desktop overflow checks, keyboard focus/labels, actual logging/resume/offline/timer/backup/meet and two-tab checks run against the production build. |

The rendered implementation was faithfully checked against this design with the documented schedule and functional adaptations. No decorative media is required for the workout tool. Physical phone installation and personal-account upload behavior are not represented by the browser checks.
