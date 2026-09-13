# Import provenance and publication boundary

Date: 2026-09-13.

| Component | Origin | Evidence / boundary |
| --- | --- | --- |
| SN Clock frontend | Existing SN Clock checkout matching deployed backend revision | `53937d5d1a77f42a64ced1805bdb8d98d60d0912`; unrelated local NED changes were not copied |
| ToM application | Existing running ToM deployment source | Imported without local settings, database, credentials, media or runtime state; original deployment had no Git history |
| Telescope snapshot reader and synthetic fixture | User-supplied `telescope_interface_20260913.zip` | Archive SHA256 `e446be54e17df9c7ba7a8936e4f3f14a5b13e2f6d8978e3b3b88feb3677438b1` |
| Vendored snapshot reader | `telescope_interface/snapshot_reader.py`, unchanged | File SHA256 `70a3e11e826b6562d719c4e30b566892e457aa9d7c8564d954619e8888291b45` |

The attachment's verification narrative describes another dashboard environment.
Its counts and historical facility request outcomes are NOT evidence of this
ToM's live data or current proposal authorization. We did not connect to that
environment, execute its historical submission examples, or copy the attachment's
internal contact/address audit into this repository.

No explicit license was included for the handed-off reader. Preserve authorship
and origin; do not label it MIT or otherwise assume an open-source license.
The repository is private for the user's integration work. Public release is held
until permission and dependency/asset notices are reviewed. Existing third-party
vendor headers are retained; only two existing Plotly bundles and the project's
own stylesheet/scripts were copied in the initial ToM static import.
