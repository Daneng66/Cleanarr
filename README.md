# Cleanarr

Smart media library cleanup and storage optimization for the *Arr ecosystem.

Cleanarr connects to Sonarr and Radarr, reads watch history from Plex and requests from Seerr
(Overseerr/Jellyseerr), evaluates your rules against your library, and removes, unmonitors, or deletes the files of items that match,
with approvals, an audit trail, and several layers of safety so a bad rule can't silently wipe your library.

It is a standalone extraction of the **Library Cleanup** feature from
[arr-dashboard](https://github.com/Kha-kis/arr-dashboard) (see [NOTICE.md](NOTICE.md)).

## Quick start

```bash
docker compose up -d --build        # then open http://localhost:8080
```

Or without Docker (Node 22+):

```bash
npm install
npm run build
CLEANARR_API_KEY=change-me npm start
```

1. **Instances**: add Sonarr and Radarr, plus Plex (watch history) and Seerr (requests) if you want rules based on them. Use the Plex server **owner's** X-Plex-Token so history for all users is visible.
2. **Rules**: create a rule, e.g. *added > 365 days ago* AND *rating < 6*.
3. **Dashboard → Preview**: see exactly what would match and why (**Why?** shows the per-condition breakdown).
4. **Settings**: when you trust the rules, turn off dry-run. Leave **Require approval** on to review each removal.

## Unraid

Install from Community Apps (search "Cleanarr"), or manually: **Docker → Add Container → Template** and paste
`https://raw.githubusercontent.com/Daneng66/Cleanarr/main/unraid/cleanarr.xml`. The image is `ghcr.io/daneng66/cleanarr`; set an API key and open the WebUI on port 8080.

To list it in Community Apps, submit this repo's template at <https://forums.unraid.net/topic/38582-plug-in-community-applications/> (Selfhosters/CA submission thread).

## Safety model

| Layer | Behaviour |
|---|---|
| Dry-run by default | Nothing is changed and no approvals are created until you turn it off. |
| Approval queue | With *Require approval* on (default), matches are queued; nothing is removed until a person approves. Approvals expire (default 7 days). |
| Live revalidation | Immediately before any write, the item is re-read from Sonarr/Radarr. Execution is blocked if its path, TMDb/TVDB id, size or file set changed since selection, or if the rule (or any retention rule) no longer says yes on fresh data. |
| Fail closed | Rules are three-valued (true / false / unknown). Missing evidence (Plex or Seerr unreachable or misconfigured, no ids, file metadata missing) is *unknown*, and unknown never matches a cleanup rule. An unknown **retention** rule protects the item. |
| Retention rules | Rules in *retention* mode protect matching items from every cleanup rule. |
| Evidence is re-read | Approvals re-fetch Plex/Seerr data at execution time; if it can't be loaded the removal is blocked, not assumed safe. |
| Never-watched guard | "Not watched in N days" only matches never-watched items once they've been in the library longer than N days. |
| Run budget | `maxRemovalsPerRun` caps removals/proposals per run. |
| Failed library loads | If an instance can't be read, it's skipped for that run (with a warning) rather than treated as empty. |
| Single run at a time | A database lease prevents scheduler/manual overlap; stale leases from a crash are reclaimed. |
| Idempotent approvals | Status changes are compare-and-set, so a double-click or two operators can't execute one approval twice. Crash-stranded executions become *retry pending*, never assumed done. |
| Rejection memory | Optionally suppress re-proposing items you rejected for N days (or forever). |
| Audit trail | Append-only event log of every selection, approval, block, failure and removal. |
| Tag / title exclusions | Per-rule excluded Sonarr/Radarr tags and (ReDoS-screened) title patterns. |

## Rules

A rule is a condition tree (`and` / `or` / `not` over leaf conditions), an **action**, and optional scope filters.
Rules are evaluated in priority order; the first matching cleanup rule wins.

**Actions:** `delete` (remove from Sonarr/Radarr and delete files), `unmonitor`, `delete_files` (keep the entry, delete files).

**Conditions**

- *Library:* age in library, size on disk, rating, IMDb rating, content rating (G, PG, TV-Y7…), release status, monitored/unmonitored, genre, release year, no files, quality profile, original language, tag, path, runtime
- *File metadata:* resolution, video codec, audio codec, audio channels, HDR type, custom format score, release group
- *Watch history (Plex):* last watched, watch count, watched by
- *Requests (Seerr):* requested or not, requested by, request age, request count, and **requester has watched it** (combines Seerr and Plex: e.g. "the person who asked for this has watched it, and it's been in the library 100+ days")

Example (JSON, as accepted by the API):

```json
{ "op": "and", "of": [
  { "type": "age", "params": { "operator": "older_than", "days": 365 } },
  { "type": "last_watched", "params": { "operator": "not_watched_in_days", "days": 180 } },
  { "op": "not", "of": { "type": "tag_match", "params": { "operator": "includes_any", "tags": ["keep"] } } }
] }
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database and generated secret |
| `CLEANARR_API_KEY` | none | Requires `Authorization: Bearer <key>` (or `X-Api-Key`) for the API; the UI prompts for it. **Set this** if the port is reachable by anyone else. |
| `SECRET_KEY` | generated into `DATA_DIR/secret.key` | Encrypts stored service keys and tokens (AES-256-GCM) |
| `LOG_LEVEL` | `info` | pino log level |

Service API keys are write-only: they are never returned by the API.

## API

All endpoints are under `/api` (`GET /healthz` is unauthenticated).

`/instances`, `/instances/test`, `/config`, `/rules` (+ `/rules/reorder`), `/rule-types`, `/preview`, `/run`, `/explain`,
`/status`, `/logs`, `/approvals` (+ `/:id/approve`, `/:id/reject`, `/:id/retry`, `/bulk`), `/audit`.

## What's different from arr-dashboard

Cleanarr is intentionally smaller. arr-dashboard's Library Cleanup spans ~69k lines because it sits on top of its
Plex/Jellyfin/Seerr/qUI/TRaSH integration stack. Not carried over (yet):

- Jellyfin/Emby, TMDb/Trakt list, and qUI/torrent-seeding rules and evidence, and Plex-only metadata rules (collections, labels, on-deck, user rating)
- Episode-level targets (Cleanarr works on whole movies and whole series)
- Media-server rescan after deletion
- Multi-user accounts, passkeys/OIDC (Cleanarr is single-user with an optional API key)
- Notification channels, backup/restore

## Development

```bash
npm run dev         # tsx watch
npm run typecheck
npm test            # vitest: rules, engine safety paths, Plex/Seerr providers, API
```

Architecture: `src/rules` (condition registry + three-valued evaluator), `src/cleanup/engine.ts` (planning, revalidation,
approvals, runs), `src/store.ts` (SQLite persistence), `src/arr`, `src/watch` (Plex) and `src/seerr` (service clients), `src/server.ts` (Fastify API + UI),
`src/web` (dependency-free UI).

## Notes for a Plex + Sonarr + Radarr + Seerr + SABnzbd stack

- Cleanarr talks to Sonarr, Radarr, Plex and Seerr. SABnzbd needs no connection: cleanup works on the library,
  not the download queue (queue cleaning is a separate feature in arr-dashboard that isn't part of this app).
- Removing a title in Sonarr/Radarr with `delete` also deletes its files; Plex picks the change up on its next scan.
  (Triggering a Plex scan after deletion isn't implemented yet.)
- Run Cleanarr on the same Docker network as your other containers and use their container names in the instance URLs
  (e.g. `http://radarr:7878`, `http://plex:32400`, `http://seerr:5055`).
