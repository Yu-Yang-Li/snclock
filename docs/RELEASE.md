# Staged release checklist

## Before switching traffic

1. Verify the actual running SN Clock / ToM / STDWeb processes and endpoints.
   Record the frontend/backend revision and take a recoverable ToM code/static
   and nginx configuration snapshot. Do not replace production `.env`, local
   settings, SQLite, media or service credentials with this repository.
2. Build and test a separate versioned release directory. Run tests with
   `tom_snclock.test_settings`, never against the production DB. Check secrets,
   attachment provenance and scoped diff. CI must pass for that commit.
3. Audit effective deployment settings. New installations should explicitly use
   `tom_snclock.production_settings`; `.env.example` is not automatically loaded.
   Existing installations must preserve their local fields, facility settings,
   object permission defaults and proxy settings, not blindly switch settings modules.
4. Set `SNCLOCK_FRONTEND_DIST` to the release build. Configure the same release's
   `/assets/` path in nginx. Keep `/static/`, `/reduce/`, certificate and ToM routes.
   Include `deploy/nginx-tom-locations.conf` inside the ToM HTTPS server; run
   `nginx -t` before any reload. Never replace `/api/` with a catch-all SN proxy.
5. Keep `TELESCOPE_SNAPSHOT_PATH` empty until a real authorized report/assets
   pair is available. Never deploy a synthetic fixture as live telescope data.
   No new DB models or migrations are introduced by the telescope adapter.

## Real click-path acceptance

- `/` renders SN Clock directly, `/source/<name>` renders the same application;
  no top-level redirect or iframe wraps the homepage.
- Candidate -> exact target (or explicit filtered target search) -> source stays
  on the ToM origin. Missing report targets do not show another target's data.
- `/targets/`, `/observations/list/`, `/dataproducts/data/`, account and `/reduce/`
  continue to work with existing authorization. Recheck a real target and data product.
- Public SN API GET, WebSocket updates, export links and 3D Earth map work;
  `/api/targets/` still resolves to Django. Public proxy rejects writes and strips
  cookies/Authorization. Wildcard CORS is limited to the public read proxy,
  never the private report or Django API.
- Embedded HTML is sandboxed without same-origin privileges. Confirm plots remain
  readable under this isolation; no silent removal of the sandbox to fix a chart.
- Log in as authorized staff and verify a real report, expected band cases,
  raw mag versus plotMag, template subtraction and one real QA raster image.
  Log out and verify the report and asset URLs are inaccessible.
- Test desktop/mobile navigation and check new errors, memory and process status.

## Rollback

Switch code/static/frontend and nginx routes back to the recorded prior versions
together, revalidate nginx, and restart/reload only the affected ToM/nginx services.
Do not roll back by deleting shared data or restoring an old DB over live writes.
Check root, target detail, SN API, Django API, account and `/reduce/` again.

## Remaining integration stages

1. Authorized real report/assets connection and per-target permission mapping.
2. Read-only facility request/status reconciliation for authorized LT/LCO/TRT
   proposals. Keep report and live evidence separate with timestamps and IDs.
3. Facility-specific validate/submit only after proposal permissions, units,
   timing and request/group ID semantics are proven. Require payload hash,
   idempotency key, explicit review and audit; unknown timeout outcome must not
   trigger blind resubmission. REM writes remain unavailable until an adapter exists.

These stages are not implemented or authorized by merely possessing the ZIP.
