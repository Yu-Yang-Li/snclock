# SN Clock

SN Clock is the homepage of this observation workspace. Sources, targets,
observations and telescope data use the same origin and navigation; the homepage
is the React application itself, not an iframe or a redirect to another site.

## Scope and current status

- `frontend/`: SN Clock frontend, imported from deployment revision
  `53937d5d1a77f42a64ced1805bdb8d98d60d0912`, with unified navigation and isolated
  embedded scientific HTML.
- `tom/`: Django/TOM Toolkit application imported from the running ToM source.
  Its previous deployment had no Git repository. Existing target, observation
  and STDWeb integrations are preserved; this is not a new telescope scheduler.
- `tom/telescope_data/`: authenticated, staff-only read adapter and workspace
  for LT / REM / LCO / TRT report snapshots, including photometry, request states,
  QA images and daily history.
- `deploy/`: reverse-proxy routing fragment. The public SN Clock backend remains
  a separately running dependency; its ingestion, model and alert code are NOT
  included in this repository. STDWeb also remains separately deployed.

The attachment contains an interface design and synthetic fixtures, not a
deployed multi-facility API or production data feed. Telescope submission,
cancellation, refresh and permission discovery are not implemented. No live
observations have been submitted by this integration.

## Local checks

Python 3.12 and Node.js 22 are used for CI. Keep a dedicated virtual environment.

```sh
python -m venv .venv
# Activate that environment for your shell.
python -m pip install -r tom/requirements.txt
cd frontend
npm ci
npm test
npm run build
cd ../tom
python -B manage.py test telescope_data custom_code --settings=tom_snclock.test_settings --noinput
```

Tests use an in-memory database and process-local cache; do not copy production
`local_settings.py`, `.env`, database, media or reports into a test checkout.
Browser acceptance additionally needs the SN read API and the explicit routes
in `deploy/nginx-tom-locations.conf`; Vite alone is not the complete ToM site.

For a local synthetic preview, explicitly set `TOM_ALLOW_SYNTHETIC_PREVIEW=1`
and `DJANGO_SETTINGS_MODULE=tom_snclock.preview_settings`, migrate the isolated
preview database, create a test user and bind `runserver` to `127.0.0.1` only.
Preview settings must never be exposed on a public interface or used in production.

## Connect a real report

1. Obtain an authorized report JSON/HTML and its matching `assets/` directory.
   Keep them outside the repository and outside the public static/media roots.
2. Set `TELESCOPE_SNAPSHOT_PATH` to the trusted local report file. Set
   `TELESCOPE_SNAPSHOT_SYNTHETIC=0` for real reports. The web request cannot choose
   an arbitrary filesystem path, remote URL or refresh command.
3. Replace a report and its assets as a versioned directory, then atomically
   switch the configured symlink. Never edit an active report/assets tree in place.
4. Verify source aliases, original magnitudes and filters, dates/time scales,
   template subtraction, request IDs and real images against that report.

Access is restricted to staff until explicit report-to-TOM object permissions
are implemented. Do not make a user staff merely to work around this restriction.
Reading a snapshot does not confirm telescope permissions, completeness or freshness.

The read-only API subset is rooted at `/telescope-data/api/v1/`:

| Route | Meaning |
| --- | --- |
| `capabilities` | Snapshot mode and disabled write capabilities |
| `targets` | Registered targets and aliases |
| `targets/{target}/photometry` | Raw measurements, not display-offset magnitudes |
| `targets/{target}/qa` | QA metadata and authenticated opaque image URLs |
| `targets/{target}/requests` | Native request, facility and processing state evidence |
| `targets/{target}/daily` | Daily report entries with report timezone |

GET only. Pagination uses `limit` (1–1000) and `offset`; `next_offset` is explicit.
`band` is case-sensitive and valid only for photometry/QA. Date filters for
requests mean submission dates, not observation dates. In the UI only photometry
receives the UTC date filter; QA archive days and Beijing daily report dates do not.
Unknown targets are distinct from known targets with zero rows. Toolkit middleware
may redirect a permission-denied request to login; the UI detects non-JSON responses.

This subset does not implement the full attachment OpenAPI contract. Non-detections
are not automatically validated upper limits. Report “processed” status does not
override `PENDING` or zero-file evidence. Daily pages and QA/request panels state
their displayed/total counts; photometry supports loading additional pages.

## Release and repository policy

Keep this repository private until the handed-off code and all imported assets
have an explicit redistribution/license review. See [provenance](docs/PROVENANCE.md).
Credentials, user databases, raw observations and actual reports do not belong in Git.
Changes should use scoped Conventional Commits and pull requests with passing CI.
CI validates code; it does not automatically deploy or authorize observations.

For production rollout, verification and rollback, see [release checklist](docs/RELEASE.md).
For the actual verification results and outstanding work, see [acceptance](docs/ACCEPTANCE.md).
