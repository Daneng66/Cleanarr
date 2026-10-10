# Cleanarr

Smart media library cleanup and storage optimization for the *Arr ecosystem.

Cleanarr connects to Sonarr and Radarr, reads watch history from Plex and requests from Seerr
(Overseerr/Jellyseerr), evaluates your rules against your library, and removes, unmonitors, or deletes the files of items that match.
Matches wait in a queue with a countdown, are re-checked against live data before anything is written, and are recorded in an
audit trail, so a bad rule can't silently wipe your library.

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

1. **Instances**: add Sonarr and Radarr (the library), plus Plex (watch history) and Seerr (requests) if you want rules based on them. Use the Plex server **owner's** X-Plex-Token so history for all users is visible.
2. **Rules**: start from a template (e.g. *Added and not watched for 60 days*, *Protect kids content*) or build your own condition tree.
3. **Dashboard**: the preview shows exactly what would match and why (**Why?** shows the per-condition breakdown). Dry run is on by default, so nothing is changed or queued yet.
4. **Settings**: when you trust the rules, turn off dry run. Matches are then queued and applied automatically after the **queue delay** (3 days by default) unless you protect them or they stop matching.

## Using it

| Page | What it's for |
|---|---|
| **Dashboard** | Current mode (dry run / live), library totals, the preview of matches with a countdown for each queued title, a last-run summary, and **Reclaim now** (the whole queue, or one title). Drill into protected titles and titles with no file. |
| **Library** | Browse every movie and series with search, filters and sorting; open a title for its details and **Why?** breakdown, or remove or protect it by hand. |
| **Rules** | Cleanup and protect (retention) rules, reordering, a library of templates, a condition builder with a JSON mode, and rule import / export. |
| **History** | Every run (with per-item outcomes) and the append-only audit trail. |
| **Instances** | Sonarr, Radarr, Plex and Seerr connections, with a connection test. |
| **Settings** | Dry run, schedule, run budget, queue delay, "suitable for kids" age, audit retention. |

The UI is responsive and follows the system light/dark preference, so checking the queue from a phone works.

## Unraid

Install from Community Apps (search "Cleanarr"), or manually: **Docker → Add Container → Template** and paste
`https://raw.githubusercontent.com/Daneng66/Cleanarr/main/unraid/cleanarr.xml`. The image is `ghcr.io/daneng66/cleanarr`; set an API key and open the WebUI on port 8080.

To list it in Community Apps, submit this repo's template at <https://forums.unraid.net/topic/38582-plug-in-community-applications/> (Selfhosters/CA submission thread).

Images (`linux/amd64`, `linux/arm64`) are published to GHCR by `.github/workflows/docker.yml` on every push to `main` (`latest`) and on `v*` tags.

## Safety model

| Layer | Behaviour |
|---|---|
| Dry-run by default | Nothing is changed and nothing is queued until you turn it off. Preview and "Run dry run" never write, even when live. |
| Queue with a delay | With dry run off, a match is queued and applied automatically once the **queue delay** elapses (default 3 days; `0` = next run). Until then you can protect it, and it is dropped if it stops matching. |
| Live revalidation | Immediately before any write, the item is re-read from Sonarr/Radarr. Execution is blocked if its path, TMDb/TVDB id, size or file set changed since selection, or if the rule (or any retention rule) no longer says yes on fresh data. |
| Fail closed | Rules are three-valued (true / false / unknown). Missing evidence (Plex or Seerr unreachable or misconfigured, no ids, file metadata missing) is *unknown*, and unknown never matches a cleanup rule. An unknown **retention** rule protects the item. |
| Retention rules | Rules in *retention* mode protect matching items from every cleanup rule. |
| Manual protection | Protect a title (or a single season) by hand; protected titles never reach cleanup rules and are refused by manual removal. |
| Evidence is re-read | Plex/Seerr data is re-fetched at execution time; if it can't be loaded the removal is blocked, not assumed safe. |
| Never-watched guard | "Not watched in N days" only matches never-watched items once they've been in the library longer than N days. |
| Run budget | `Max removals per run` (default 50) caps both executions and new queue items per run. |
| Failed library loads | If an instance can't be read, it's skipped for that run (with a warning) rather than treated as empty. |
| Single run at a time | A database lease prevents scheduler/manual overlap; stale leases from a crash are reclaimed. |
| Idempotent execution | Status changes are compare-and-set, so a double-click or two operators can't execute one item twice. Crash-stranded executions become *failed* and can be retried, never assumed done. |
| Audit trail | Append-only event log of every proposal, block, failure and removal, pruned after the configured retention (default 7 days). |
| Tag / title exclusions | Per-rule excluded Sonarr/Radarr tags and (ReDoS-screened) title patterns. |

## Rules

A rule is a condition tree (`and` / `or` / `not` over leaf conditions), **actions**, and optional scope filters (service, instance, excluded tags, excluded title patterns).
Rules are evaluated in priority order; retention rules always win, and the first matching cleanup rule decides the action.

**Actions** (set per rule, with optional per-slot overrides for movies, continuing series and ended series):

- `delete`: remove from Sonarr/Radarr and delete files
- `unmonitor`: keep the entry and files, stop monitoring
- `delete_files`: keep the entry, delete files
- `delete_season`: Sonarr only; delete one season's episode files and unmonitor that season

A rule that uses `delete_season` is evaluated on individual seasons as well as whole series.

**Conditions**

- *Library:* age in library, size on disk, rating (TMDb/Arr), IMDb rating, content rating (G, PG, TV-Y7…, or "suitable for kids"), release status, monitored / unmonitored, no monitored seasons, genre, release year, has no files, quality profile, original language, tag, path, runtime
- *File metadata:* resolution, video codec, audio codec, audio channels, HDR type, custom format score, release group
- *Watch history (Plex):* last watched, watch count, watched by, has an episode unwatched for a while
- *Requests (Seerr):* requested or not, requested by, request age, request count, **requester has watched it**, **requester watched the whole season**, and watched by someone other than the requester (the last three combine Seerr and Plex: e.g. "the person who asked for this has watched it, and it's been in the library 100+ days")

Example (JSON, as accepted by the API):

```json
{ "op": "and", "of": [
  { "type": "age", "params": { "operator": "older_than", "days": 365 } },
  { "type": "last_watched", "params": { "operator": "not_watched_in_days", "days": 180 } },
  { "op": "not", "of": { "type": "tag_match", "params": { "operator": "includes_any", "tags": ["keep"] } } }
] }
```

After a successful removal, Cleanarr also clears the title's request from Seerr (best effort; a Seerr failure is logged and does not retry the removal).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` (`/data` in Docker) | SQLite database and generated secret |
| `CLEANARR_API_KEY` | none | Requires `Authorization: Bearer <key>` (or `X-Api-Key`) for the API; the UI prompts for it. **Set this** if the port is reachable by anyone else. |
| `SECRET_KEY` | generated into `DATA_DIR/secret.key` | Encrypts stored service keys and tokens (AES-256-GCM) |
| `LOG_LEVEL` | `info` | pino log level |

Service API keys are write-only: they are never returned by the API. Runtime behaviour (dry run, schedule, run budget, queue delay, kids age, audit retention) is configured in the UI under **Settings**.

### Scheduling

With **Run on a schedule** on, Cleanarr runs every N days / weeks / months at a set server-local time. **Dry run does not stop the schedule**: scheduled runs still happen and just record what they would do. Turning the schedule on, or turning dry run off, triggers a run right away rather than waiting a full interval.

## API

All endpoints are under `/api` (`GET /healthz` is unauthenticated).

| Area | Endpoints |
|---|---|
| Meta | `GET /auth`, `GET /status`, `GET /rule-types`, `GET /rule-templates`, `GET /requesters` |
| Instances | `/instances` (+ `/:id`, `/:id/test`), `POST /instances/test` |
| Settings | `GET` / `PUT /config` |
| Rules | `/rules` (+ `/:id`), `PUT /rules/reorder` |
| Runs | `POST /preview`, `POST /run` (`dryRun`, `immediate`, `only`), `POST /explain` |
| Library | `POST /library`, `POST /library/remove`, `GET /series/:instanceId/:seriesId/episodes`, `GET /link/:instanceId/:arrItemId` |
| Queue | `GET /approvals`, `POST /approvals/:id/approve`, `POST /approvals/:id/retry` |
| Protection | `GET` / `POST /protected`, `DELETE /protected/:id` |
| History | `GET /logs`, `GET /logs/:id`, `GET /audit` |

## Limitations

- Sonarr, Radarr, Plex and Seerr only (no Jellyfin/Emby, list providers, or torrent-client evidence)
- Targets are whole movies, whole series and whole seasons, not individual episodes
- No media-server rescan after deletion
- Single user with an optional API key (no accounts, passkeys or OIDC)
- No notification channels or backup/restore

## Development

```bash
npm run dev:api     # API with tsx watch, on :8080
npm run dev:web     # Vite dev server for the React UI
npm run typecheck   # server and web
npm test            # vitest: rules, engine safety paths, Plex/Seerr providers, API
npm run build       # tsc → dist/, vite → dist/web
```

Architecture:

- `src/rules`: condition registry, three-valued evaluator, templates, per-slot actions, ReDoS-screened regex
- `src/cleanup/engine.ts`: planning, queueing, revalidation, execution, runs; `src/cleanup/scheduler.ts`: the schedule tick
- `src/store.ts` / `src/db.ts`: SQLite persistence and migrations
- `src/arr` (Sonarr/Radarr), `src/watch` (Plex), `src/seerr`: service clients
- `src/server.ts`: Fastify API, serves the built UI from `dist/web`
- `web/`: React + Vite UI (`web/src/features` per page, `web/src/components` shared UI)

## Notes for a Plex + Sonarr + Radarr + Seerr + SABnzbd stack

- Cleanarr talks to Sonarr, Radarr, Plex and Seerr. SABnzbd needs no connection: cleanup works on the library,
  not the download queue.
- Removing a title in Sonarr/Radarr with `delete` also deletes its files; Plex picks the change up on its next scan.
  (Triggering a Plex scan after deletion isn't implemented yet.)
- Run Cleanarr on the same Docker network as your other containers and use their container names in the instance URLs
  (e.g. `http://radarr:7878`, `http://plex:32400`, `http://seerr:5055`).
