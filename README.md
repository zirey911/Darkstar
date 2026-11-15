# Darkstar — Martian Survival Guide

An educational Mars Explorer, rover navigator and astronaut Marswalk planner,
prepared for NASA Space Apps 2026. Independent project: no NASA affiliation,
endorsement or operational safety certification.

## Features

- Global Mars imagery, topography, USGS geology and numerical 3D terrain;
  searchable landmarks, coordinate inspection and geographic route overlays.
- Windowed MOLA terrain processing and an installed-data option for a 20 m
  Jezero CTX DEM crop. A* rover routes support distance or estimated energy costs.
- **Rover | Marswalk** switch below the map. Marswalk plans habitat → science
  objective → return, with walking speed, slope, EVA time, oxygen, power and reserve
  budgets; route profiles and warnings remain visible across map modes.
- NASA-sourced landing-site examples for Perseverance, Curiosity and InSight,
  with explicitly hypothetical EVA destinations. Evidence markers identify
  slope-limit violations, uncertainty and science objectives on 2D maps.
- Historical NASA/PDS environmental context, with no fabricated local weather.
- Groq AI survival chat with a small reviewed NASA/PDS knowledge index, clickable
  citations, conversation history and signed Explorer/mission context. Ollama
  and OpenAI-compatible APIs remain configurable alternatives.

## Local setup

Use Node.js 24.x, npm 11 and Python 3.12. From the repository root:

```sh
npm ci
python3.12 -m venv services/navigation/.venv
services/navigation/.venv/bin/python -m pip install -r services/navigation/requirements-dev.lock
services/navigation/.venv/bin/python -m pip install --no-deps -e 'services/navigation[dev]'
```

If `services/navigation/.env` does not already exist, copy
`services/navigation/.env.example` to that path. Preserve an existing file.
Set these values in the backend file:

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-120b
LLM_API_KEY=your_private_key_here
```

The backend loads this file without overriding process environment variables.
Never commit `.env` or use a `NEXT_PUBLIC_` variable for credentials. The template
contains no key. See [provider switching](docs/CHAT.md).

Prepare the numerical terrain (downloads are explicit; data files are not in Git):

```sh
services/navigation/.venv/bin/python scripts/prepare_terrain.py
services/navigation/.venv/bin/python scripts/prepare_jezero.py
```

MOLA downloads approximately 66 MB; the Jezero script retrieves a regional window
and stores approximately 1 MB. Missing terrain produces an unavailable-data error.

Run in two terminals:

```sh
npm run dev:backend
```

```sh
npm run dev:web
```

Open **http://localhost:3000/terrain**; backend health is
**http://127.0.0.1:8000/health**. Select **Marswalk → Load example Marswalk · Jezero
→ Plan Marswalk** for the short round-trip demo. Alternatively use the NASA
landing-site selector. Gale and InSight examples are coarse MOLA scenarios and
exceed the default EVA budgets. Open AI survival chat and attach Explorer context
for a sourced explanation of calculated results.

## NASA/USGS data and scientific limitations

| Capability | Source | Limits |
| --- | --- | --- |
| Surface imagery | NASA Mars Trek Viking; NASA/JPL/MSSS/Caltech CTX V01 via Esri | Colorized composite, not natural color. Streamed tiles; gaps and registration offsets are possible. Imagery is not elevation. |
| Global elevation | [NASA PDS MGS MOLA MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html) | 16 pixels/degree, about 3.7 km north–south; unsupported cells blocked. |
| Jezero elevation | [USGS/PDS Mars 2020 CTX DEM](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic) | Native 20 m regional crop, not global detailed coverage. |
| Geology | USGS global geologic map of Mars | 1:20,000,000 mapping; regional units, not local outcrop classifications. |
| Environment and AI references | Pinned NASA/PDS publications and historical extracts | Historical context only; no live weather, location-specific radiation dose or current dust assessment. |

Full provenance, coordinate conventions and source links:
[data sources](docs/DATA_SOURCES.md), [terrain](docs/TERRAIN.md),
[chat](docs/CHAT.md).

Routes snap to DEM cell centres; sub-cell connections and obstacles are not
validated. Global routing is regional (up to 600 km, 12° longitude span, within
±80° latitude). Rover energy and astronaut consumption are hypothetical models,
not measured NASA rover or astronaut performance. Budget compliance is not EVA
clearance. No suit physiology, storm forecast, radiation protection, water budget
or rescue capability is certified. Green markers indicate scientific intent, not
safe terrain. In 3D, hazard evidence is accessible below the map; spatial hazard
markers are currently 2D only. AI numerical/citation guards can withhold answers
and cannot prove that every generated interpretation is correct.

## Checks

```sh
npm run build
npm run typecheck
npm run test:web
npm run test:backend
```

If this machine's sandbox prevents Turbopack from binding its internal worker port,
`npm run build --workspace @darkstar/web -- --webpack` performs a production build
using Next.js's alternative bundler. This does not disable SSR.

## Public hosting

Public deployment is **not yet verified**. The intended split is Vercel for
`apps/web` and a Python service for FastAPI. Account authentication and any billing
approval must be completed before deployment.

- Vercel: import this repository, select the Next.js project at `apps/web`, Node
  24.x, and include repository files outside the root for npm workspace resolution.
  Set server-only `DARKSTAR_API_URL` to the backend HTTPS URL, then redeploy.
- Python host: retain the repository scripts and `data/processed` paths. Install
  the backend dependencies and run both terrain preparation scripts during the
  build. Use Python 3.12; numerical data must be present in the runtime image or
  persistent storage. The backend command from the repository root is:
  `python -m uvicorn darkstar_navigation.main:app --app-dir services/navigation/src --host 0.0.0.0 --port "$PORT" --workers 1`.
- Set `LLM_PROVIDER`, `LLM_MODEL` and the secret `LLM_API_KEY` in the Python host's
  secret environment settings only. Do not upload the local `.env` to GitHub or
  Vercel. Do not print its contents. `LLM_BASE_URL` is optional.
- Browsers call same-origin Next.js `/api` routes; Next.js contacts FastAPI
  server-to-server. This architecture requires **no cross-origin browser CORS
  allowance**. Do not add a wildcard CORS policy.
- Use one backend worker/replica for the current process-local snapshot signing
  key; restarting invalidates attached context. Reinspect/replan afterward.
- Before announcing a public URL, verify `/health`, terrain metadata/inspection,
  map tiles, a real Jezero Marswalk, and a live cited chat answer with attached
  context through the public frontend. External data-service availability and
  provider limits remain dependencies.

Hosting references: [Vercel monorepos](https://vercel.com/docs/monorepos),
[Vercel environment variables](https://vercel.com/docs/environment-variables),
[Railway FastAPI](https://railway.com/guides/fastapi).

## Repository

`apps/web` contains Next.js; `services/navigation` contains FastAPI and terrain
services; `scripts` prepares data and starts the backend; `docs` records provenance,
architecture and setup. `data/raw` and `data/processed` are ignored local artifacts.
See [development instructions](docs/DEVELOPMENT.md),
[architecture](docs/ARCHITECTURE.md) and [project brief](docs/PROJECT_BRIEF.md).
