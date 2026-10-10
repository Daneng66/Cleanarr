---
target: dashboard item details
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/neonsoftware/SourceCode/Cleanarr/web/src/features/dashboard/TitleDetail.tsx"
target_fingerprint: "sha256:81615a82f7a39f546c9c893c31249d872f422af6782a698625a959caf4a1b9c8"
target_path: /Users/neonsoftware/SourceCode/Cleanarr/web/src/features/dashboard/TitleDetail.tsx
timestamp: 2026-10-10T21-49-13Z
slug: web-src-features-dashboard-titledetail-tsx
---
Method: dual-agent (A: design review · B: detector). Target: dashboard item details (TitleDetail.tsx). Assessed before the layout/properties change in the same session.

Score 25/40 (Acceptable). Detector: 0 findings (TitleDetail.tsx, LibraryDetailDialog.tsx); CSS not scanned; dashboard loaded with no console errors, dialog not opened in browser.

Priority issues
- P1 Queue status shows "Queued · removes …" for every non-failed status, including reclaimed (TitleDetail.tsx QueueStatus). Fix: explicit reclaimed/running/blocked states. Command: harden
- P1 Run mode (dry run / live) absent from the dialog; confirm text omits mode and impact. Fix: mode strip, relabel button in dry run. Command: clarify
- P1 Footer has 5 equal controls; destructive Run now same weight as Close; phone wraps to 2-3 rows. Fix: Protect + Run now primary, links secondary, drop footer Close. Command: layout, adapt
- P2 Hierarchy: 46px size outranks consequence and due date. Fix: verdict line + impact sentence first, size supporting. Command: bolder, typeset
- P2 Missing-evidence and failure states thin: lastError raw, no retry on episode count failure, unknown conditions invisible. Command: harden

Minor: action tag duplicated; "Not rated" noise; inline style on tree rows; Close duplicates header X; dialog closes before reclaim completes.
