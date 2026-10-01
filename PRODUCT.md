# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
A solo homelab admin: one technical self-hoster running their own Plex + Sonarr/Radarr (+ optional Seerr) stack. They set up instances and write rules occasionally, then check in, often from a phone, to review and approve queued removals.

## Product Purpose
Cleanarr reclaims storage by evaluating user-written rules against the Sonarr/Radarr library, using watch history (Plex) and requests (Seerr) as evidence, and then deletes, unmonitors, or deletes the files of the items that match. Success means the admin gets their space back without ever losing something they wanted to keep.

## Positioning
Safety is the product. Rules are three-valued and fail closed, so missing evidence never matches. It defaults to dry-run, keeps an approval queue, re-validates each item against live data immediately before every write, gives retention rules priority, and keeps an append-only audit trail. Every removal can be explained ("Why?") condition by condition.

## Operating Context
- Self-hosted on a LAN (Docker or Node 22), usually unauthenticated unless `CLEANARR_API_KEY` is set.
- Core loop: add instances, write rules, preview, dry-run, then go live with approvals, approve or reject from the queue, and review history and the audit trail.
- Approving and rejecting from a phone is a real, recurring use case.
- Screens: Dashboard, Rules (with the condition builder and JSON mode), Approvals, History (runs and audit), Instances, Settings, the Explain dialog, and the API-key sign-in.

## Capabilities and Constraints
- Instance types: Sonarr, Radarr, Plex (watch history), and Seerr (requests). Tautulli support has been removed.
- Actions: `delete`, `unmonitor`, `delete_files`. Rule modes: `cleanup` and `retention`. Rules are evaluated in priority order, and the first cleanup match wins.
- Condition groups: Library, File metadata, Watch history, Requests.
- Frontend: static `src/web` (HTML/CSS/vanilla ES module) copied into `dist` at build time, with DOM built via `textContent` only, because titles and reasons come from external services. This must be preserved.
- The UI must support both light and dark themes, following the system color scheme.
- Run modes shown globally: Dry run, Live with approval, and Live automatic.

## Brand Commitments
Name: Cleanarr, part of the *Arr naming family. The existing favicon is a teal rounded square with a line mark. The owner has made no binding visual commitments.

## Evidence on Hand
No testimonials, user counts, or benchmarks exist. None should be invented.

## Product Principles
1. Never surprise the admin: every destructive action is previewable, explainable, and confirmed.
2. The current mode (dry run or live) and anything pending must always be obvious.
3. Unknown counts as safe: surface missing evidence as a warning, never hide it.
4. The admin's time is scarce: the check-in-and-approve loop must be fast, especially on mobile.

## Accessibility & Inclusion
Usable on phone-width screens with touch targets suited to approving and rejecting; follows the system light and dark preference.
