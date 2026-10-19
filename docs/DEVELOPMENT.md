# Development

## Requirements

Use Node.js 24.15 or newer within 24.x (see `.nvmrc`), npm 11, and Python 3.12 (the CI baseline).
The backend package supports Python 3.11+; other versions are not all tested.
Git and network access to GitHub, npm and PyPI are required for first-time setup.
Run commands below from the repository root `Nasa_Darkstar/Darkstar`.

## Install

```sh
npm ci
python3.12 -m venv services/navigation/.venv
services/navigation/.venv/bin/python -m pip install -r services/navigation/requirements-dev.lock
services/navigation/.venv/bin/python -m pip install --no-deps -e 'services/navigation[dev]'
mkdir -p data/raw data/processed
```

On Windows, use `py -3.12 -m venv services/navigation/.venv` and replace
`services/navigation/.venv/bin/python` with `services/navigation/.venv/Scripts/python.exe`.
The root backend command helper automatically selects the platform's virtual environment.
No activation or `.env` file is needed. Do not put credentials in tracked files.

## Run

In separate terminals:

```sh
npm run dev:web
npm run dev:backend
```

Frontend: http://localhost:3000. Backend: http://127.0.0.1:8000.
`curl --fail http://127.0.0.1:8000/health` should return `{"status":"ok"}`.
FastAPI API documentation is at `/docs`. Both processes stop with Ctrl+C.
The landing page does not call the backend yet.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Individual commands: `lint:web`, `lint:backend`, `test:web`, `test:backend`.
`npm run build` produces the frontend production build; start it using
`npm run start --workspace @darkstar/web`. The backend runs directly through Uvicorn;
no separate compilation step is needed. CI runs these checks on pushes to `main`
and pull requests. Frontend testing checks the visible project identity and scope;
backend testing exercises the HTTP health contract through TestClient.

## Dependency updates

Commit `package-lock.json` with npm changes and use `npm ci` for reproducible installs.
To deliberately update Python dependencies, resolve `pip install --upgrade -e
'services/navigation[dev]'` in a fresh environment, run verification, then regenerate
`requirements-dev.lock` with `pip freeze --exclude-editable`. Keep the local editable
package out of the lockfile. Review changes before committing. Heavy planned geospatial
dependencies are intentionally absent.

## Troubleshooting

- Missing backend environment: create `.venv` and perform both pip install commands.
- Wrong interpreter: use the explicit virtual-environment Python path; do not install globally.
- Unsupported Node or package errors: select Node 24 (`nvm use` if available), then `npm ci`.
- Generated Next.js type errors: run `npm run typecheck`, which generates route types first.
- Ports in use: stop the other local process or supply a different port directly to Next.js/Uvicorn.
- Registry/DNS failures: check network access or proxy configuration; do not disable TLS verification.
- Large datasets: keep them under ignored `data/raw` or `data/processed`; record provenance in docs.

See `ARCHITECTURE.md` for scope restrictions and planned geospatial considerations.

## Known dependency advisory at initialization

On 2026-10-19, `npm audit` reported five high-severity findings in the development-only
ESLint dependency chain (`eslint-config-next` → Next ESLint plugin → `fast-glob` →
`micromatch` → `braces`). These refer to the same deeply nested pattern denial-of-service
advisory, GHSA-vfj7-8cjw-p6xm. The latest published `braces` was 3.0.3 with no patched
release available. The suggested forced downgrade of Next lint tooling was not applied.
`npm audit --omit=dev` reported zero production advisories. Recheck on dependency updates.

The current Starlette TestClient emits a deprecation warning for HTTPX; tests pass.
Evaluate its recommended HTTPX2 migration when updating the testing stack.
