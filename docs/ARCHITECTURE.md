# Architecture

Darkstar contains educational AI chat, global NASA Viking imagery, and regional
MOLA terrain analysis/A* routing. Advanced resource calculations and simulations
are not implemented. The project is independent; NASA affiliation or endorsement is not implied.

## Layout and responsibilities

- `apps/web`: Next.js App Router, strict TypeScript, Tailwind CSS, ESLint,
  Vitest and React Testing Library. Mars chat UI and same-origin `/api/chat` server proxy.
- `services/navigation`: installable Python 3.11+ package using FastAPI,
  Pydantic and Uvicorn. Exposes `GET /health`, `POST /chat`, and `/terrain` metadata, route and imagery APIs.
- `packages/shared`: reserved for future API contracts; no runtime package yet.
- `docs`: preserved project research plus architecture and development guidance.
- `data/raw`, `data/processed`: ignored local data directories, never bundled into the web app.
- `scripts`: root command helpers; `.github/workflows`: independent web/backend CI jobs.

The services run independently; Next.js forwards HTTP JSON chat requests to Python.
Python owns provider credentials and validates bounded conversation histories.
See [chat configuration and limits](CHAT.md). No database or authentication exists.
The terrain page is `/terrain`; Python owns windowed raster reads and pathfinding.
See [terrain contracts, coordinates and limitations](TERRAIN.md).

## Choices and planned dependencies

npm workspaces keep frontend tooling in one lockfile. A Python virtual environment
isolates the backend; a frozen development requirements file records the tested
resolution while `pyproject.toml` declares package compatibility ranges. Docker and
native build systems are unnecessary at this stage.

NumPy and rasterio support terrain processing. A* uses Python's standard heap queue.
The map uses SVG with equirectangular NASA Trek tiles, avoiding Earth-map defaults
and additional frontend mapping dependencies. No NetworkX or standalone PyProj is
needed for this bounded spherical-grid implementation.

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
