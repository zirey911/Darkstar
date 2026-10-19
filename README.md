# Darkstar

Preparatory infrastructure for a Mars navigation and expedition-planning project
intended for the NASA Space Apps Challenge 2026 Abu Dhabi event. This independent
project does not imply NASA affiliation or endorsement.

**Current scope:** a minimal development landing page and FastAPI health endpoint.
Mars mapping, terrain analysis, routing and simulations are not implemented.
Competition development rules must be confirmed before building those features.

## Quick start

Use Node.js 24.15+ (24.x), npm 11 and Python 3.12. From this repository root:

```sh
npm ci
python3.12 -m venv services/navigation/.venv
services/navigation/.venv/bin/python -m pip install -r services/navigation/requirements-dev.lock
services/navigation/.venv/bin/python -m pip install --no-deps -e 'services/navigation[dev]'
npm run dev:web
# In another terminal:
npm run dev:backend
```

Open http://localhost:3000 and http://127.0.0.1:8000/health.
Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` to verify.
See [development instructions](docs/DEVELOPMENT.md) for Windows and troubleshooting.

## Repository

```text
apps/web/                 Next.js, TypeScript, Tailwind and frontend tests
services/navigation/      Python package, FastAPI and backend tests
packages/shared/          Reserved for future shared contracts
scripts/                  Backend command helper
.github/workflows/        CI checks
docs/                    Research, architecture and setup documentation
data/                    Data policy; raw/ and processed/ are local and ignored
```

- [Project brief](docs/PROJECT_BRIEF.md)
- [Candidate data sources](docs/DATA_SOURCES.md)
- [Engineering decisions](docs/DECISIONS.md)
- [Architecture](docs/ARCHITECTURE.md)

No planetary data or heavy geospatial dependencies are installed during setup.
