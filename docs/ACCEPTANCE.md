# Acceptance — 2026-09-13

## Follow-up polish

- Repository visibility is public at the owner's explicit request. The history
  scan found no common secret-token signatures, production environment/database
  files, or real report payloads. No open-source license is inferred for the handoff.
- 32 Django regression tests and 3 Node display tests passed after the changes.
- Browser: a target opened with `band=R` retains the filter after reload; clearing
  filters preserves the target and returns all 3 synthetic measurements.
- Browser: the non-detection's reported limit 20.2 is visible without drawing it
  as a detection or passing it to a model. UTC midnight displays as 08:00 Beijing.
- Chinese state labels retain native codes and the contradictory PENDING /
  processed / zero-file warning. Unknown codes remain unknown.
- UI checks each response and paginated page against the displayed report's
  SHA256. A version mismatch clears results and requires a page refresh.
- Login links retain target/filter context; empty reports get an explicit message.
- Still preview-only: production code, data, facility submissions and permissions
  were not changed by this polish.

Status: implemented in an isolated checkout and validated in a loopback-only
preview. **Not deployed to the production ToM. No real telescope report connected.**

## Completed checks

- Original attachment reader: 9 tests passed using Python UTF-8 mode. The first
  Windows attempt used GBK and failed reading a UTF-8 fixture; UTF-8 execution passed.
- ToM existing regressions plus adapter/home tests: **30 tests passed**, Django
  5.2.16, using the existing runtime's Python environment but an isolated source
  checkout, in-memory test DB and process-local cache. No production DB used.
- Frontend: TypeScript/Vite production build passed; 2 existing frontend tests
  passed. Vite emits an inherited empty `vendor-react` chunk warning; build succeeds.
- Nginx integration: separate loopback preview configuration syntax check passed;
  production nginx files and running services were not replaced or reloaded.
- Actual browser: homepage is SN Clock at `/`, connected WebSocket/public read
  data visible. Navigating to telescope data and returning home stays on the same
  origin. An isolated demo account was created only in the preview database.
- Actual browser: staff telescope page displays the synthetic warning, 3 original
  measurements, original magnitude 19.1 rather than plotMag 20.1, separate request
  status `PENDING` / `processed` / 0 files and a consistency warning.
- Actual browser: selecting uppercase `R` leaves one TRT non-detection and no
  plotted detection. Missing QA assets explicitly remain unavailable.
- Actual browser: the sandboxed 3D Earth frame loads public data and shows its
  source counts/update time; adding isolation did not leave the frame stuck loading.
- Main navbar URLs were checked against actual Toolkit menus; observations use
  `/observations/list/`, data use `/dataproducts/data/`, not guessed short paths.
- Browser at 390 x 844: homepage navigation remains visible; telescope filters
  stack vertically and remain usable. Desktop viewport was restored afterwards.
- Proxy probes: public read 200, Django target API 200 (separate empty preview DB),
  public API POST rejected with 403. Direct sky HTML has wildcard public-read CORS
  and a sandbox CSP without same-origin privileges.
- Anonymous and non-staff report/asset access, unknown targets, invalid filters,
  pagination, raw magnitude preservation, status conflicts, missing files,
  encoded path traversal, raster-only assets and report-cache refresh have tests.

## Not yet accepted

- Real LT/REM/LCO/TRT report/assets, snapshot freshness and matching against real
  measurements and real image products; attachment includes synthetic data only.
- Per-target report permissions for ordinary observers; staff-only access is a
  temporary fail-closed boundary, not a permission integration.
- Native facility request/status reconciliation or validate/submit/cancel. No
  proposal credentials/authorization have been validated by this integration.
- Production deployment and real existing target/data-product/STDWeb regression.
  Preview success does not establish production acceptance.
- Public redistribution/license approval for imported handoff code/assets.
- Full SN backend consolidation: this repository versions the frontend and ToM
  integration; the existing SN inference/ingestion service remains a dependency.

GitHub-hosted frontend and ToM CI both passed for implementation commit
`05d5fae1a8dc1636b36cf4ed9cd9ba6bcfafa57c`:
[run 34740850088](https://github.com/Yu-Yang-Li/snclock/actions/runs/34740850088).
The remote's commit SHA was checked against the local SHA.

Whitespace review: unchanged imported Plotly code and commented scaffold in
`custom_code/models.py` contain inherited trailing whitespace. They were retained
to preserve import provenance; new/modified code is checked separately.
