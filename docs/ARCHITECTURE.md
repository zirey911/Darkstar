# Architecture

Darkstar currently contains development infrastructure only. Mapping, terrain analysis,
routing, resource calculations, and simulations are deferred until competition rules
are confirmed. The project is independent; NASA affiliation or endorsement is not implied.

## Layout and responsibilities

- `apps/web`: Next.js App Router, strict TypeScript, Tailwind CSS, ESLint,
  Vitest and React Testing Library. Currently a development landing page.
- `services/navigation`: installable Python 3.11+ package using FastAPI,
  Pydantic and Uvicorn. Currently exposes only `GET /health`.
- `packages/shared`: reserved for future API contracts; no runtime package yet.
- `docs`: preserved project research plus architecture and development guidance.
- `data/raw`, `data/processed`: ignored local data directories, never bundled into the web app.
- `scripts`: root command helpers; `.github/workflows`: independent web/backend CI jobs.

The services run independently. Future communication may use HTTP JSON with schemas
published through FastAPI OpenAPI. Endpoint contracts, deployment origin, CORS policy,
and coordinate/unit semantics must be decided before integration. No network integration,
authentication, database, or environment secrets are currently needed.

## Choices and planned dependencies

npm workspaces keep frontend tooling in one lockfile. A Python virtual environment
isolates the backend; a frozen development requirements file records the tested
resolution while `pyproject.toml` declares package compatibility ranges. Docker and
native build systems are unnecessary at this stage.

Planned, not installed: NumPy for numerical arrays, Rasterio for raster ingestion,
PyProj for coordinate transformations, NetworkX for graph research, and MapLibre GL JS
for browser map rendering. Evaluate these only when the relevant work is authorized.
No data-processing or route algorithms exist yet.

## Planetary geospatial constraints

Earth-oriented mapping defaults must not silently become Mars assumptions. Before any
geospatial implementation, document each product's reference body and radii,
planetocentric versus planetographic latitude, longitude direction and range,
projection, horizontal/vertical units, elevation reference, resolution and nodata.
Do not assign Earth WGS84 or Web Mercator semantics to Mars data by default.
Dataset metadata and authoritative planetary references must determine transforms;
validate control points, seams and poles before combining products. Browser rendering
coordinates and scientific computation coordinates may need separate representations.
Record provenance and uncertainty; results must not be presented as validated safety advice.

## Tooling references

- [Next.js installation and separate lint step](https://nextjs.org/docs/app/getting-started/installation)
- [FastAPI testing with TestClient](https://fastapi.tiangolo.com/tutorial/testing/)
