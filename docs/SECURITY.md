# Security review

Scope: the local API (`src/api.py`), the XML validator, the dashboard (single static HTML file), dependencies and repository secrets. All data is synthetic; nothing is hosted besides static GitHub Pages.

| Area | Test | Result |
|---|---|---|
| API | SQL injection in path and query (`' OR 1=1--`, `; DROP TABLE`) | Safe: queries are parameterised; bad input gets 404/422 |
| API | Path traversal, NUL bytes, 5,000-char IDs, negative or huge `limit`/`days` | Rejected with 422 |
| API | `as_of=2026-02-30` | **Found**: regex accepted it and the server returned 500. **Fixed**: real-date validation, now 422 |
| API | CORS, unexpected methods | No CORS headers; POST returns 405. Added `nosniff` and `no-store` headers |
| XML | Entity expansion (billion laughs) and external entities (XXE) | **Found** (bandit B314/B405): stdlib parser. **Fixed**: `defusedxml`, reported as `unsafe_xml` |
| Dashboard | XSS through URL hash, `localStorage` values, parser textarea, Q&A search | No script execution; values are numeric-checked or HTML-escaped |
| Dashboard | Regex on a 200,000-character line | 0.19 s, no catastrophic backtracking |
| Dashboard | CSV export formula injection (`=`, `+`, `-`, `@`) | **Hardened**: such cells are prefixed with `'` |
| Dashboard | No Content-Security-Policy | **Fixed** on the GitHub Pages build: no network (`connect-src 'none'`), no frames, no forms, only Google Fonts allowed |
| Dependencies | `pip-audit` on `requirements.txt` | No known vulnerabilities |
| Secrets | Pattern scan of the tree and git history | None found |
| Static analysis | `bandit` | Remaining findings are false positives (table names in an f-string, `random` used for sampling) |

Known limits: the CSP keeps `'unsafe-inline'` for scripts because the dashboard is one self-contained file; the API has no authentication because it is meant to run locally only (do not expose it publicly as is).

Tests: `tests/test_api.py` and `tests/test_xmltv.py` guard the fixes above.
