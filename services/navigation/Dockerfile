FROM python:3.12-slim-bookworm AS base
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 GDAL_CACHEMAX=32 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /app
COPY services/navigation/pyproject.toml services/navigation/pyproject.toml
COPY services/navigation/src services/navigation/src
RUN pip install --no-cache-dir ./services/navigation && python -c "import rasterio; print(rasterio.__version__)"

FROM base AS terrain
COPY scripts/prepare_terrain.py scripts/prepare_jezero.py scripts/
COPY services/navigation/build_terrain.py services/navigation/build_terrain.py
RUN python services/navigation/build_terrain.py

FROM base AS runtime
COPY services/navigation/main.py services/navigation/main.py
COPY --from=terrain /app/services/navigation/data/processed /app/services/navigation/data/processed
WORKDIR /app/services/navigation
EXPOSE 10000
# One worker avoids duplicating terrain caches; excess concurrency receives HTTP 503.
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --limit-concurrency 4"]
