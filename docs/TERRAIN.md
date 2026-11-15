# Mars terrain and regional routing

## Run locally

Install the updated Python dependencies and package using the README setup commands.
From the repository root:

```sh
services/navigation/.venv/bin/python scripts/prepare_terrain.py
npm run dev:backend
# Separate terminal:
npm run dev:web
```

Open `/terrain` (or follow the map link from chat). The initial coordinates are a
real-data example: 60°N, 30°E → 61°N, 32°E. Click **Calculate route**, then **Focus
start** to inspect it. You can choose both points on the map or enter coordinates.
Chat remains at `/`; it does not receive terrain context or claim to compute routes.

The preparation command downloads two 33,177,600-byte numerical PDS rasters plus
labels (about 66 MB total), hashes each file, and writes a compressed tiled GeoTIFF.
It streams downloads and converts 256×256 windows from memory-mapped source files.
It never reads a whole planet-sized array into RAM. Existing prepared data is left
alone; interrupted downloads use `.part` files. An incomplete final raw file is
rejected, not silently repaired or used. Remove that specific incomplete file before
retrying. Data is local under ignored `data/raw/mola16` and `data/processed`.

`DARKSTAR_TERRAIN_PATH` optionally selects another location for the **same prepared
16 ppd, two-band dataset**. Arbitrary Earth or higher-resolution DEMs are rejected.
`DARKSTAR_API_URL` remains the server-only Next.js backend URL setting. No NASA API
key is required. Imagery needs network access to Esri and NASA Mars Trek; numerical routing
works offline after preparation. Failed detailed imagery retains explicitly labeled coarse imagery underneath.

## Data and coordinates

- Elevation: NASA Mars Global Surveyor, Mars Orbiter Laser Altimeter (MOLA),
  MEGDR v2.0, `megt90n000eb.img`. These are signed big-endian 16-bit **numerical
  median elevations in metres**, not heights inferred from image colors.
- Support: matching `megc90n000eb.img` observation counts. The source supplies
  interpolated elevations in zero-count bins; those values are retained in the
  raster but blocked for routing. No source nodata sentinel is declared. Invalid
  counts or heights outside the label's −8177 to 21171 m range are also blocked.
- Grid: 5760×2880, 16 pixels/degree, global 0–360° east longitude, north to south.
  Outer edges are 0°, 360°, +90°, −90°; centres are offset by half a cell.
  IAU2000 planetocentric/body-fixed coordinates. The API/UI accepts −180° to +180°
  east longitude and wraps regional reads at both longitude seams.
- Mapping sphere: 3,396,000 m radius from the product label, **not Earth WGS84**.
  Distances use great-circle geometry on this sphere, an approximation to the
  physical Martian surface. Cell spacing is 3704.46 m north–south and approximately
  that value × cos(latitude) east–west.
- Heights: planetary radius minus the GMM3 (mgm1025) areoid evaluated to degree/order
  50. Data acquired in 1997–2001; v2 product creation 2003. Not current conditions.
- Fallback imagery: NASA/JPL-Caltech/USGS Viking MDIM 2.1 colorized global mosaic, nominal
  source resolution 232 m, served through NASA Mars Trek equirectangular WMTS.
  Imagery is only a visual basemap; it does not supply elevation or traversability.
  Source imagery is much finer than the routing grid, and color is a mosaic product.

Every prepared raster embeds its source URLs, source-file SHA-256 checksums,
preparation timestamp, resolution, datum and missing-data policy. The same metadata
is in `data/processed/mola16.json`, `/terrain/metadata`, and every route response.
PDS `.lbl` and `.xml` files are retained alongside the raw data.

Sources:
- [NASA PDS MOLA product overview](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html)
- [Maintained PDS4 16 ppd archive](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/)
- [Topography label](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/megt90n000eb.lbl)
- [Count label](https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/megc90n000eb.lbl)
- [Viking WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml)
- [NASA Trek tile API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)

## Terrain and route model

Rasterio reads only the bounding region plus a 1° margin. An eight-entry in-process
LRU cache stores immutable elevation and slope arrays, keyed by file path, size,
modification timestamp and window bounds. Each request is bounded to endpoints
within 600 km, a longitude span of at most 12°, and latitude within ±80°. Polar
imagery remains viewable, but polar routing is rejected. No global route search is
attempted. Changing the source file invalidates the cache through its key; restarting
also clears it. Imagery has a separate 128-tile memory cache and HTTP cache headers.

Slope is `atan(hypot(dz/dx, dz/dy))`, with central finite differences in metres,
latitude-dependent east–west spacing and the product's spherical radius. Cells
without an observed height, a valid central-difference stencil, or with slope above
the configured limit are not traversable. Window edges are excluded. This conservative
policy can disconnect large areas, particularly near the equator where observations
are sparse. A missing-data error does not imply physically impassable terrain.

A* generates routes on demand using eight adjacent cells. Diagonal moves require
both adjacent orthogonal cells to be traversable. Each edge also checks its own
absolute elevation-change angle against the slope limit. Both objectives use admissible lower bounds described below.

## Rover energy and route objectives

The Explorer offers editable **Scout** (200 kg, Crr 0.05, efficiency 0.70,
1000 Wh traction budget, 15° limit) and **Carrier** (1000 kg, Crr 0.08,
efficiency 0.65, 5000 Wh, 12°) scenarios. These are hypothetical profiles,
not NASA rover specifications or measured performance. All parameters can be
changed without changing code. Mass includes the vehicle and its load.

For each edge, `d` is spherical horizontal distance in metres and `dz` is the
signed elevation change in metres. Constant Mars gravity is **3.71 m/s²**,
consistent with [JPL planetary parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html).
The quasi-static model assumes constant-speed rolling on a locally planar segment:

```
segment_length_m = hypot(d, dz)
rolling_work_J = Crr * mass_kg * g * d
net_wheel_work_J = rolling_work_J + mass_kg * g * dz
battery_traction_J = max(0, net_wheel_work_J) / drivetrain_efficiency
braking_heat_J = max(0, -net_wheel_work_J)
energy_Wh = sum(battery_traction_J) / 3600
```

Rolling work uses `Crr * normal_force * segment_length`, where normal force is
`m*g*cos(theta)`. Since `cos(theta)*segment_length = d`, this gives the expression
above. Downhill gravity offsets rolling resistance; surplus energy is dissipated
as brake heat. There is **no regenerative braking** or negative battery usage.
Brake heat is mechanical dissipation, not additional electrical consumption.
Mass (kg) × acceleration (m/s²) × displacement (m) gives joules.

A* supports `optimization: "distance"` (default, sum of 3D segment lengths) or
`"energy"` (sum of electrical traction joules). It uses the same directional
edge model for search and reporting. The distance heuristic is spherical horizontal
distance. The energy heuristic is `max(0, m*g*(Crr*direct_distance + remaining_dz))/efficiency`:
it is a lower bound because edge distances obey the triangle inequality, elevation
changes telescope, and each positive-work sum is at least the net work. Unsupported
cells, diagonal corner cutting, excessive terrain slopes and excessive edge grades
remain blocked in both modes. The effective slope limit is the smaller of the
request-level cap and the rover profile limit.

`rover` accepts `mass_kg`, `rolling_resistance`, `drivetrain_efficiency`,
`max_slope_deg` and `energy_capacity_wh`. Values must be finite; mass, efficiency
and capacity are positive, efficiency is at most 1, Crr is 0–1, and slope is 0–35°
(excluding zero). Legacy top-level `slope_weight`, `energy_weight` and
`rolling_resistance` are accepted for older clients but no longer affect search;
use `optimization` and `rover.rolling_resistance` instead.

`compare: true` evaluates both objectives with identical terrain/rover settings,
returning a summary table in `comparisons`. The selected route supplies the map and
profile. An alternative search failure is labeled in `comparison_error` without
hiding a successful selected route. Each search retains its 12-second budget;
comparison proxy/client timeouts allow both searches. Large-grid corridor refinement
can yield approximate results: neither comparison is a guarantee of a global optimum.

Route output includes `energy_j`, `energy_wh`, `braking_loss_j`,
`energy_capacity_fraction`, `within_energy_capacity`, `optimization_cost` (metres
or joules), effective slope limit, rover assumptions and active DEM provenance.
Capacity is a **traction-only available budget**. Over-budget paths remain visible
with an explicit warning, not presented as energy-feasible. Small endpoint snap
connections remain unvalidated and excluded from distance/energy.

This model excludes wheel slip, sinkage, variable soil resistance, steering losses,
acceleration, speed-dependent efficiency, motor/brake limits, thermal management,
computing, communications, science payloads and charging. Zero predicted downhill
traction consumption does not mean zero total rover power. Uniform mass/efficiency
scale energy; they do not alone change the chosen route. Capacity does not alter
search costs. The model is an exploratory estimate, not mission-range prediction.

Regions larger than 12,000 cells first try a conservative 4×4 coarse grid. Every
constituent fine cell must have a valid slope; maximum fine slope is retained.
A coarse route suggests a corridor, then A* reruns on original cells. If that fails,
the full native regional grid is searched. Final routes never use an interpolated
coarse path. A corridor-constrained result need not be the global least-cost route.
The search has a 12-second budget and returns an error if it is exhausted.

Coordinates snap to their containing cell centres. The response reports the two
snap distances and excludes those unvalidated endpoint connections from its route
length. Same-cell endpoints are rejected rather than presenting a false zero-distance
route. Route points, cumulative distances, heights, ascent/descent and maximum slopes
are returned. The UI draws the route and elevation profile; crossing the display
seam unwraps route vertices and draws world copies, avoiding a line across the whole map.

## API

- `GET /terrain/metadata`: readiness, dataset provenance and limits.
- `POST /terrain/route`: `start: {lat, lon}`, `end: {lat, lon}`, optionally
  `max_slope_deg`, `rover`, `optimization`, `compare`.
- `GET /terrain/tiles/{zoom}/{row}/{col}`: allowlisted Viking imagery only, zoom 0–7.

Next.js exposes these through `/api/terrain/...`. Missing/unreadable data returns
503; unsupported coordinates, blocked endpoints, same-cell points or no route
returns 422. Imagery failures return 502. No generated/mock geography is served.

## Verification and remaining limits

Essential tests cover spherical distances and longitude wrap, planar slope,
missing-data stencil, 8-direction routing, diagonal blocking, edge/cell slope
limits, coarse-to-fine refinement, unavailable data and a real MOLA route including
an antimeridian crossing. The real-data test skips in CI unless data is prepared;
synthetic calculation tests do not require a download. Frontend tests check route
rendering, elevation profile, stale-result clearing and data-unavailable errors;
existing chat tests remain in place.

The global and Jezero examples demonstrate data/software integration,
**not scientific route validation**.
Independent control-point/terrain validation is still required before detailed
expedition planning, including within the installed 20 m CTX region. Rocks, sand, small craters,
cliffs, traction and local hazards are unresolved. Better sparse-data treatment must
carry uncertainty rather than silently treating interpolated bins as observations.
Full polar routing, global high-resolution routing, live conditions and advanced
vehicle physics are outside this foundation. Browser visual inspection was blocked
by unavailable browser access; automated UI and HTTP integration checks are used.

## Explorer controls and inspection

The existing `/terrain` page is now the Mars Explorer. Drag with a pointer or one
finger to pan, use the wheel or buttons to zoom, and choose surface imagery or MOLA
topography. Arrow keys pan the focused map; Enter selects/inspects the map centre.
Coordinate fields remain available for precise, keyboard-accessible endpoint entry.
Inspect mode leaves route endpoints alone. The inspector can assign the selected
point as either endpoint. Route edits invalidate stale results.

`POST /terrain/inspect` takes `{lat, lon}` and automatically selects CTX inside its valid footprint, otherwise returns the MOLA height,
observation count, cell centre, source resolution, and slope/support status. A
zero-count height is explicitly labelled interpolated, not observed, and remains
blocked for routing. Polar points can be inspected but routing is still limited
to ±80°. Inspection support is separate from the vehicle's chosen slope limit.

`GET /terrain/topography/{zoom}/{row}/{col}` renders cached 256×256 PNG tiles from
the local numerical raster using nearest-neighbour display sampling and a fixed
−8177 to 21171 m colour scale. Zero-count cells are dimmed; invalid values are dark.
The map legend documents this distinction. Tiles read bounded windows, use a
32 MB GDAL cache, and do not require additional image or mapping dependencies.
At overview zoom, sampling is for display only; routing still uses native cells.
Topography works offline after preparation; Viking imagery needs NASA connectivity.

### Explorer navigation refinements

Longitude panning wraps continuously; imagery/topography tile columns wrap to their
source matrix, and route vertices are unwrapped across the antimeridian before
drawing world copies. Latitude remains clamped at the poles. The equirectangular
view is distorted there; it does not claim a polar projection or polar routing.
Wheel zoom uses fractional levels anchored under the cursor, with real overview
tiles retained beneath detail tiles while they load. Pointer drag, keyboard arrows
and zoom buttons remain available. Reset clears both endpoints and stale route
results, Swap reverses the selected endpoints, and Load example restores the
verified regional example. Successful routes automatically frame their endpoints
using the shortest longitude span. The installed CTX footprint supports detailed exploration.


## Jezero CTX regional DEM

Prepare the optional regional data after MOLA, from the repository root:

```sh
services/navigation/.venv/bin/python scripts/prepare_jezero.py
```

The source is the [Mars 2020 Science Investigation CTX DEM Mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic),
PDS v1.0, `urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic`.
This is a **numerical stereo elevation model**, not imagery. The JPL/USGS product
uses CTX stereo processing and is vertically localized to MOLA. Its 20 m posting
is not a claim of 20 m horizontal or vertical accuracy.

The preparation script reads a pixel-aligned window of the
[public DEM](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif)
using HTTP ranges. It does not download the full 90 MB mosaic. The source is
scanline-striped, so requested rows include pixels outside the selected crop.
The installed 676 × 534 pixel crop occupies about 1 MB compressed and spans
77.379845–77.620318° E, 18.359942–18.540120° N (roughly 13.5 × 10.7 km).
It covers part of Jezero, not the entire crater.

Native coordinates are equirectangular on a 3,396,190 m Mars sphere, with standard
parallel 18.4663° N, central meridian 0°, planetocentric latitude and east-positive
longitude. Native pixels are 20 × 20 projected metres; longitude/latitude spacing
differs. Slopes and spherical distances account for that spacing and local latitude.
Elevations remain original float32 metres, with the source nodata sentinel masked.
No elevations are resampled or filled. Source URL, PDS identifier, CRS, bounds,
source window, ETag, resolution, datum and label hash are embedded in the GeoTIFF;
the accompanying JSON also records the crop SHA-256. The PDS XML is retained in
`data/raw/jezero`. All downloaded data stays Git-ignored.

`DARKSTAR_REGIONAL_PATH` optionally points to another location for this same prepared
crop. It is not a generic DEM registration interface. `/terrain/metadata` advertises
installed coverage; `/terrain/region-map` serves its cached, nodata-transparent relief
image. Inspection reads a 3 × 3 neighbourhood. Routing reads the endpoint bounding
window plus 16 cells (320 m) of search margin, capped at 180,000 cells. Reads and
slopes are cached by file identity and window. The existing eight-direction A* and
coarse-to-fine refinement are reused with native CTX spacing.

Valid inspection points and routes with both endpoints supported inside the crop
select CTX automatically. Outside coverage, or for unsupported detailed endpoints,
the whole operation falls back to MOLA with an explicit reduced-accuracy label.
A blocked detailed route is not retried on MOLA to bypass its slope constraint.
No route blends datasets across a seam or fills CTX gaps with coarse elevations.
MOLA itself can be unsupported, and short endpoints may share a single MOLA cell;
these conditions return errors rather than fabricated routes.

In `/terrain`, choose **Explore Jezero · 20 m** or **Load Jezero route**, then
**Calculate route**. Gold outlines show installed bounds, not guaranteed valid pixels.
Zoom reaches level 12; source imagery retains its original resolution. At zoom 7+
the topographic layer overlays CTX with a labeled local −3000 to −2000 m color scale.
Transparent nodata reveals coarse background, while inspection identifies the actual
selected dataset. Dataset/resolution badges accompany inspection and route results.

Verified with actual data: 18.4447° N, 77.4508° E → 18.45° N, 77.46° E returns
a short native 20 m route. Its distance and ascent depend on the selected objective;
comparison output reports both using the same rover assumptions.
Tests check native raster coordinate registration, anisotropic slope calculation,
route slope limits, elevation/profile output, PNG rendering, missing regional data
and nodata fallback. This verifies software integration, not field navigability.
Remaining work: independent scientific validation, additional explicitly registered
regions and, if needed later, carefully datum-aware cross-dataset routing. Small
rocks, sand and other sub-cell hazards remain unresolved.

### Energy verification

Focused tests verify joule/Wh units, efficiency/mass scaling, uphill/downhill
work and braking without regeneration, invalid profile rejection, slope constraints,
and a synthetic hill where a longer route uses less energy. A real Jezero API
comparison independently sums edge energy and 3D distance from the returned profile
and checks capacity warnings and both objectives. MOLA/CTX inspection and routing
regression checks remain in place. Synthetic terrain tests validate the algorithm;
they are not presented as NASA measurements.


## Streamed CTX surface imagery

The surface layer now uses the [Global CTX Mosaic V01 catalog service](https://www.arcgis.com/home/item.html?id=30c4acfe36284b1784bf07d5d73f9e4d),
hosted by Esri at `https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer`.
Attribution: NASA/JPL/MSSS/Caltech Murray Lab/Esri. This is grayscale imagery,
not the numerical Jezero CTX DEM. The catalog identifies V01; the service-level
description still contains legacy beta wording, so retain the catalog identifier
when citing this layer.

Evaluation: the [Murray Lab V01 mosaic](https://murray-lab.caltech.edu/CTX/V01/TilePages/)
has nominal 5 m pixels and covers 99.5% between 88°S and 88°N. Its full uncompressed
archive is approximately 10 TB ([NASA PDS](https://pds.nasa.gov/ds-view/pds/viewBundle.jsp?identifier=urn%3Anasa%3Apds%3Amars_mro_ctx_globalmosaicv01_murraylab_2023)).
No archive download is needed. NASA Trek's
[CTX WMTS capabilities](https://trek.nasa.gov/tiles/Mars/EQ/CTX_beta01_uncontrolled_5m_Caltech/1.0.0/WMTSCapabilities.xml)
advertise the older beta mosaic and point to Esri's `OnMars/CTX` service (WMTS levels
0–11). That service was tested successfully; the newer V01 catalog's `CTX1` endpoint
was chosen after testing it too. Existing Viking imagery remains the coarse fallback.

The CTX1 service advertises 512 × 512 pixel PNG tiles, but actual responses include
JPEG as well; the backend validates signatures and returns the matching MIME type.
The grid has origin (−180°, 90°), 2^(z+1) columns and 2^z rows, using the Mars 2000
sphere (3,396,190 m), east-positive longitude and planetocentric latitude. This
matches existing map geometry without shifting routes, clicks or DEM inspection.
`GET /terrain/ctx/{zoom}/{row}/{col}` is a fixed-host, validated proxy with bounded
responses, ten-second upstream timeout, 128-tile memory cache and daily HTTP caching.

Darkstar requests levels 0–12. Level 12 is 0.0000858306884765625° per pixel,
approximately **5.09 m north–south** (east–west spacing decreases with latitude).
Although the server advertises levels through 17, those exceed the nominal 5 m
source sampling and are not used. Low zoom levels show downsampled imagery, not
5 m detail. Overview CTX, a coarser CTX parent and Viking tiles stay underneath
asynchronous detail tiles; failed detail images are hidden and a notice appears.
Retry uses the existing control. Missing coverage can be opaque gaps in the source:
these are not automatically classified or filled. If all services fail, the map
shows its existing unavailable-imagery notice; coordinates remain selectable.

No API key or login was needed for the verified public requests. Network access to
`astro.arcgis.com` and `trek.nasa.gov` is required. The backend proxy avoids browser
cross-origin restrictions. The catalog grants free use of the source data with
attribution; Esri hosting remains subject to its linked service terms and availability.
This is a lossy visual mosaic with seams, gaps and possible registration offsets,
not survey-grade ground control. No claim of pixel-accurate alignment to MOLA is made.
Elevation/routing remain at **MOLA ~3.7 km** or **installed Jezero CTX DEM 20 m**;
5 m imagery does not improve their numerical resolution.

Verified live upstream and through FastAPI: global tile `0/0/0`, Olympus regional
`7/50/32`, and Olympus detail `12/1623/1051` (18.65°N, 226.20°E = −133.80°).
All decode as 512 × 512 images with nonuniform pixels. Automated Explorer checks
verify that the Olympus coordinate lies inside its rendered detail tile, progressive
parents remain present, and an image failure exposes fallback. Source images were
visually inspected; a full interactive browser walkthrough was not performed.

## Compact Explorer and 3D terrain

The Explorer now starts with a compact header and mode selector. The map precedes
the route planner and terrain inspector. Its over-map directional pad moves the
geographic viewport; Global restores the 2D planetary overview. The existing
2D pointer drag, cursor-anchored wheel zoom, keyboard selection, longitude wrapping,
CTX imagery and route calculations are unchanged. Overview, Topography and 3D Terrain
share selected endpoints and the geographic location. Olympus Mons and Jezero
shortcuts provide useful real-data starting points.

3D Terrain renders an actual shaded triangle surface from numerical DEM heights,
using a dependency-free Canvas renderer and an orthographic 3D camera. Drag rotates
and tilts; Shift-drag or right-drag pans the camera; wheel zooms. Keyboard arrows
rotate/tilt, Shift-arrows pan, +/− zoom, Home resets, and Enter selects the terrain
under the canvas centre. Pointer selection intersects projected triangles and returns
the corresponding geographic point to the existing inspector/endpoint controls.
Coordinates selected on the display mesh are approximate; inspection still reads
the native DEM cell. The existing route profile supplies the 3D route overlay.

`POST /terrain/mesh` takes `{lat, lon, span}` (signed API longitude; span 0.02–12°).
It uses the existing CTX window cache when the centre is inside the installed crop,
clipping to that footprint; otherwise it uses MOLA with an explicit fallback label.
MOLA requests have a minimum 0.5° span so zooming cannot fabricate sub-cell geometry.
Polar 3D patches beyond ±85° return a clear error; the 2D map remains available.
The view uses a local equirectangular metric approximation, not a curved global mesh.
A global 2D viewport therefore opens a regional 12° patch at the same centre in 3D.

Level of detail is selected from geographic span and native resolution. MOLA retains its native samples within the bounded window (at most 193 per axis);
CTX display sampling is capped near 160 samples per axis. Samples retain original
elevations at native cell centres. Each triangle checks all native samples in its
footprint, including its boundary; unsupported faces are omitted without erasing
neighboring valid vertices. No synthetic fine detail, nodata
filling, new sources or cross-dataset elevation blending is introduced. The renderer
reports native and display spacing. Camera zoom magnifies the existing mesh;
geographic zoom requests a new window and updates its sampling density.

Relief defaults to true vertical scale (1×); optional 2×/5× visualization-only exaggeration is explicitly
labeled. Colors and lighting describe the numerical surface; CTX photos are not
draped onto it. This is a bounded regional visualization, not a full globe or a
photorealistic terrain engine. The CPU painter renderer is suitable for these capped
meshes, not large high-resolution scenes. Route lines are drawn as a visible overlay,
without terrain occlusion; endpoint markers use nearest display elevations. Camera
pose resets when leaving and re-entering 3D, while geographic location and selections
remain. Missing data and missing Canvas support have explicit messages.

Verification covers real Olympus MOLA relief (>21 km elevation), native CTX samples,
longitude seam registration, mesh size bounds, missing-data holes, camera transforms,
keyboard pan/tilt/rotation/zoom/reset, coordinate picking, existing 2D interactions,
TypeScript/lint checks and a production build. Full browser visual QA remains blocked
because Computer Use access to Chrome was not approved.

## Landmark selector

The compact searchable field above the map includes Olympus Mons, Valles Marineris,
Jezero Crater, Gale Crater, Hellas Planitia, Elysium Mons and Utopia Planitia. Choose a
browser suggestion or type an exact name (case-insensitive); Go/Enter recenters the
same landmark after panning. Partial/unrecognized text does not move the map.
Selection sets only map center/zoom and its landmark readout; it preserves the active
mode, route endpoints and computed route. The readout links to each USGS feature page.

The selected landmark has a purple named pin, distinct from circular S/D route
markers. Click the pin (or focus it and press Enter/Space) for a compact popup with
its name and 0–360° E coordinates. Pins follow map pan/zoom and mode changes.
In 3D, the pin is projected through the terrain camera onto a supported mesh
triangle; it is hidden outside the loaded patch, in missing-data areas, or outside
the viewport. Surface interpolation is for visual placement only. The 3D pin is
an overlay, so foreground terrain does not occlude it. Selecting or opening a
landmark never changes route endpoints.

Coordinates are the USGS Gazetteer's updated mapped feature centers, verified
2026-11-10, in planetocentric latitude and 0–360° east longitude. Feature pages also
list legacy coordinate-network values. The catalog in `apps/web/app/terrain/landmarks.ts`
retains the feature IDs and explicit view zoom choices:

| Landmark | Latitude | Longitude E | USGS feature |
| --- | ---: | ---: | --- |
| Olympus Mons | 18.65 | 226.20 | [4453](https://planetarynames.wr.usgs.gov/Feature/4453) |
| Valles Marineris | -14.01 | 301.41 | [6288](https://planetarynames.wr.usgs.gov/Feature/6288) |
| Jezero Crater | 18.21 | 77.62 | [14300](https://planetarynames.wr.usgs.gov/Feature/14300) |
| Gale Crater | -5.37 | 137.81 | [2071](https://planetarynames.wr.usgs.gov/Feature/2071) |
| Hellas Planitia | -42.43 | 70.50 | [2432](https://planetarynames.wr.usgs.gov/Feature/2432) |
| Elysium Mons | 25.02 | 147.21 | [1783](https://planetarynames.wr.usgs.gov/Feature/1783) |
| Utopia Planitia | 46.74 | 117.52 | [6260](https://planetarynames.wr.usgs.gov/Feature/6260) |

These are feature centers, not rover landing coordinates or guaranteed terrain
coverage. Jezero's feature center is outside the installed detailed crop; the
existing crop shortcut remains available. Large features use wider 2D framing,
while 3D retains its existing 12° regional-patch limit. Browser-native search
suggestion appearance varies. No online gazetteer request is needed to navigate.


### 3D continuity and framing correction

The former display sampler erased an entire coarse vertex footprint whenever it
contained one unsupported native sample, then discarded both triangles around any
missing quad corner. This unnecessarily enlarged real MOLA gaps into rectangular
holes. MOLA now retains native vertices; CTX uses finer bounded sampling. Per-triangle
support masks prevent bridging hidden nodata between coarse vertices, while retaining
valid triangles on the other side of a gap. No elevation values are filled or modified.

The initial camera now uses a more oblique tilt and fits connected terrain bounds to
the canvas, rather than a fixed scale unrelated to the mesh. Reset/Home restores the
fit; new geographic windows reset stale camera pan/zoom. Small pointer jitter no longer
rotates the scene during clicks; canceled/lost captures clear drag state. Rotation,
tilt, pan and zoom remain independent of geographic navigation and elevation values.

Real-data verification at Olympus (18.65°N, 226.20°E, 12° patch) retained 33,689 of
36,864 possible native triangles, with real heights −2,263 to 21,171 m. Remaining
holes are unsupported MOLA measurements. At 18.447°N, 77.455°E inside the Jezero crop,
the tested 0.08789° patch supports all 15,990 display triangles. Source cells remain
20 m; its display stride is 2 (40 m north–south). True-scale relief can still look
gentle over wide areas; optional 2×/5× exaggeration changes visualization only.
Focused checks cover retained vertices, hidden-gap face rejection, fitting, source
height preservation, camera controls and selection. Browser visual inspection remains
unavailable because Chrome access was not approved.


### Consistent colorized Overview

Overview now keeps NASA Trek's Viking MDIM 2.1 colorized mosaic as its global
color backdrop. The CTX V01 Esri tiles are genuinely monochrome: live verification
returned one gray band for CTX and three RGB bands for Viking. The former normal
opaque CTX-over-Viking compositing caused grayscale rectangles wherever CTX loaded,
with colored Viking visible elsewhere. It was not a coordinate or decoder error.

At map zooms above 4, CTX parent/detail tiles fade in as one luminosity-blended group
(maximum opacity 0.85), retaining Viking hue/saturation instead of replacing it with
gray. Both global Viking overview tiles must load before CTX is displayed. Failed CTX
tiles expose coarse detail or Viking; failed global color tiles disable the detail
group. Browsers without luminosity blend support keep the Viking basemap. All tile
coordinates, image endpoints and overlay geometry are unchanged. No scientific raster
is recolored or modified on disk; this is a browser visualization composite only.

This is explicitly **colorized, not natural-color imagery**. Viking itself combines
coarse color information with the MDIM monochrome mosaic, as described by
[USGS](https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m).
CTX's [black-and-white camera](https://www.jpl.nasa.gov/news/new-interactive-mosaic-uses-nasa-imagery-to-show-mars-in-vivid-detail/)
adds brightness texture, not fine-scale color measurements. Nominal 232 m Viking
mosaic sampling does not imply that its original color measurements resolve 232 m;
they are coarser. CTX display sampling reaches ~5.09 m but colors do not. Brightness
seams, source gaps, registration differences and network failures can remain. This
composite must not be used for quantitative spectral/color analysis or elevation.

Checks verify base-load gating, progressive parents, blend-group opacity, Olympus
tile alignment and failed-detail fallback. Source tiles were fetched and inspected;
full browser visual validation remains unavailable due to denied Chrome access.

## Marswalk planner

Choose **Marswalk** in the planner selector above the map. Use **Set habitat** and
**Set science stop** to choose one location for each, or load the installed Jezero
example. Habitat (H) and science (SCI) markers work in all three map modes (3D
requires loaded terrain). Enter an objective and work duration, adjust walking
speed/slope/duration limits, oxygen and power capacities, and an emergency reserve,
then **Plan Marswalk**. Both journeys are drawn; coincident return routes overlap.
The single summary includes phase budgets and separate outbound/return elevation
profiles. Editing mission inputs or endpoints invalidates the previous plan.
Rover mode remains available with its original controls.

`POST /terrain/marswalk` (proxied through `/api/terrain/marswalk`) runs the existing
shortest-distance A* twice, reversing endpoints for return. Both runs use the
astronaut slope limit and existing missing-data rejection. MOLA fallback is
explicitly labeled. Rover traction estimates are discarded, not reused as human
metabolic estimates. A failed leg rejects the mission; no partial route is offered
as a complete round trip.

For one hypothetical astronaut, travel hours = (routed surface distance + straight
endpoint-to-cell distances) / configured walking speed. Science hours are entered
by the user. Oxygen kg and power Wh are each phase's hours multiplied by its
configured kg/h or W rate. Required capacity = total use / (1 − reserve fraction).
Reserve is a fraction of installed capacity and cannot be spent by the nominal
plan. EVA duration includes outbound travel, work and return. The initial example
uses 2 km/h, 15° slope, 30 minutes science, a 240-minute limit, 1 kg oxygen, 1000 Wh
power and 25% reserves; travel/science rates are 0.15/0.10 kg oxygen per hour and
250/200 W. These are editable educational assumptions, not NASA-certified values.

No suit-up/airlock/rest timeline, physiology, terrain-dependent walking speed,
weather, radiation, thermal balance, water, communications or rescue model is
included. Endpoint connections are budgeted but not traversability-validated.
Even the Jezero 20 m DEM cannot resolve foot-scale hazards; global MOLA is much too
coarse for operational walking. Passing budgets is not a safety certification.
One science stop is supported in this phase; there is no multi-stop itinerary or
mission persistence. No deployment changes or additional datasets are required.

## Geology layer and science destinations

**Geology** is a fourth 2D map mode; Overview, Topography and 3D remain available.
Click to inspect the source geological polygons. The lookup is independent of DEM
availability and reports every intersecting unit code/description, with no inferred
classification for empty or failed responses. Maps and queries use USGS SIM 3292,
Tanaka et al. (2014), **1:20,000,000**, hosted by Esri:

- Publication and full legend: https://pubs.usgs.gov/sim/3292/
- Tiles: https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/Mars_geology_All_layers_100pct/MapServer
- Units: https://services.arcgis.com/nzS0F0zdNLvs7nc8/ArcGIS/rest/services/Mars_Geology_feature_layer/FeatureServer/0

The source uses Mars spherical geographic CRS 104971. Tile origin is **−180°, +180°**,
not the imagery grid's +90° origin. Native tiles span 360/2^level degrees. The layer
requests level 2 as a backdrop and caps progressive detail at level 6; a live Jezero
level-8 tile was unavailable. Level 6 display sampling is ~0.022°/pixel (~1.3 km at
the equator), not the geological mapping accuracy. Zooming further enlarges these
regional classifications. Colors represent units, not terrain height or natural
color. Unit boundaries can be uncertain or have multiple intersections. Poles and
seams may have no polygon despite the global nominal coverage. Missing tiles retain
loaded coarser geology or remain blank with a warning, never switch to unlabeled
imagery. Public services currently need no credentials but require internet access
and can be unavailable or rate limited. Small reads are bounded and cached; no
large GIS download is required.

The Marswalk **Verified science destination** selector sets the science endpoint,
objective and map center, preserving habitat and map mode. The catalog uses these
USGS feature centres (planetocentric latitude, 0–360° E), verified 2026-11-15:

| Destination | Latitude | Longitude E | Coordinate source |
| --- | ---: | ---: | --- |
| Jezero Crater | 18.21 | 77.62 | https://planetarynames.wr.usgs.gov/Feature/14300 |
| Neretva Vallis | 18.55 | 77.20 | https://planetarynames.wr.usgs.gov/Feature/15879 (MDIM 2.1) |
| Gale Crater | -5.37 | 137.81 | https://planetarynames.wr.usgs.gov/Feature/2071 |

NASA science descriptions are linked in the UI and catalog (`science-destinations.ts`):
Jezero's lake/delta history, Neretva's ancient river channel, and Gale's layered
sedimentary environments. These are regional destinations, not precise sample,
landing, rover or verified safe outcrop coordinates. All three feature centres lie
outside the installed Jezero crop: MOLA fallback and unavailable routes remain
explicit. A nearby habitat and locally validated site are necessary for meaningful
walking plans. Geology does not change A*, resource estimates, elevation, or slope
constraints. No detailed Jezero geological polygons or mineral abundance model
have been added.

Verification: live Jezero (18.4447 N, 77.4508 E) query returned HNt, “Hesperian and
Noachian transition unit”; global level-2 and Jezero level-6 PNG tiles loaded.
Focused tests cover native tile alignment, CRS query parameters, missing data,
source destination/mission objective transfer, and preservation of habitat.

## Environmental context (historical, not operational)

Inspect a map coordinate to open the compact environmental panel. A planned
Marswalk also shows context for its habitat and science destination. Temperature,
thin-atmosphere, dust and ionizing-radiation concerns are qualitative; no invented
hazard thresholds, safety scores, radiation-dose projections or route/resource
changes are applied. Passing the existing EVA budgets does not clear environmental
hazards. **All mission-time/local conditions remain unavailable.**

`POST /terrain/environment`, proxied through `/api/terrain/environment`, accepts
one or two labeled coordinates. It returns small pinned reference extracts from
`services/navigation/src/darkstar_navigation/environment_reference.json`.
No API key, external runtime request, new dependency or large dataset is required.
These extracts were retrieved 2026-11-15 and do not refresh automatically. Original
feed records, dust row/product identifier and source SHA-256 hashes are retained
alongside source URLs. Numerical measurements are under Data Details to avoid
suggesting that they describe the selected coordinate.

| Source integrated | Extract and coverage | Interpretation |
| --- | --- | --- |
| NASA/CAB Curiosity REMS outreach feed | Sol 4995, 2026-08-25; rover-local Gale observations | Air −71 to −5 °C; ground −84 to 4 °C; pressure 777 Pa. Daily sampled summary, no numeric uncertainty supplied. |
| NASA Perseverance weather summary | Sol 1133, 2024-04-27; rover-local Jezero-region observations | Air −79.3 to −24.7 °C, pressure 778.9 Pa; ground temperature not supplied. |
| PDS Lemmon et al. Mastcam optical-depth product | Sol 3953.5493, image `3953ML1047940011206693C00_DXXX`; Gale atmospheric column | 880 nm optical depth 0.591; reported Sigma 0.030. Derived from solar imaging; dust plus possible ice, not particle concentration or toxicity. |
| NASA summary of Curiosity RAD measurements | August 2012–June 2013, Gale | Reported mean dose-equivalent rate 0.67 mSv/day; not a mission dose or a global radiation map. |

Sources and scientific archives:

- REMS summary: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
- REMS PDS archive: https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/rems.html
- Perseverance summary: https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json
- MEDA PDS archive (pressure, air/ground thermal and optical/dust instruments): https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html
- Optical-depth dataset overview: https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity/atmospheric_opacity.html
- Dust table and label: https://atmos.nmsu.edu/PDS/review/PDS4/msl_mmm_tau_bundle/data_derived/msl_tau_880.csv and https://atmos.nmsu.edu/PDS/review/PDS4/msl_mmm_tau_bundle/data_derived/msl_tau_880.xml
- RAD published summary: https://www.nasa.gov/news-release/nasa-rover-results-include-first-age-measurement-on-mars-and-help-for-human-exploration/
- PDS mission archive directory linking RAD EDR/RDR at the PPI node: https://pds-geosciences.wustl.edu/missions/msl/index.htm

The dust overview currently links a **review-directory copy**. This status is
visible in the panel; certification is not asserted. Its XML describes a product
span of 2012-09-08 through 2023-09-19, and gives decimal true-solar sols for rows;
no exact UTC is fabricated for the selected row. Sigma's confidence convention is
not specified in the label. The label also has an inconsistent host-name field
(`InSight`) while its identifiers reference MSL; the snapshot retains the MSL
product identifier and source links, without silently claiming a certified release.

The weather feeds are outreach summaries, not a scientific-quality replacement
for calibrated PDS REMS/MEDA products. Missing markers remain null, never zero.
The raw REMS “Sunny” and UV fields are retained only for provenance and are not
interpreted as dust clearance or ionizing radiation. MEDA optical/thermal radiation
and Curiosity RAD ionizing radiation are distinct measurements. The RAD summary
provides no numerical uncertainty; shielding, solar activity and exposure geometry
are not modeled.

Reference distances use existing Mars distance calculations to the USGS Jezero and
Gale crater centres, not to a sensor position, and never assign coverage by radius.
There is no nearest-site interpolation, global environmental layer, forecast or
modeled estimate. The same historical records are available from any selected
point, explicitly as reference observations, while local conditions remain unknown.
Endpoint context does not represent every point along a mission route.

To update the pinned extracts, retrieve and review the linked sources, select the
record by its actual date/sol, retain the raw row and hash, and verify units and
missing-data markers before replacing the JSON. Remaining scientific work includes
certified dust-release verification, calibrated PDS time-series ingestion with rover
positions and quality flags, and separately validated mission-time environmental
and shielding models. None is simulated in this implementation.

### NASA landing-site Marswalk examples and evidence markers

The Marswalk planner offers Jezero/Perseverance, Gale/Curiosity and
Elysium Planitia/InSight. `apps/web/app/terrain/mission-examples.ts` links NASA
landing-coordinate publications and science explanations. Landing positions are
reference starts for **hypothetical habitats**; destinations and EVA objectives
are educational planning scenarios, not documented NASA traverses or confirmed
local outcrops. Loading an example restores the default hypothetical EVA budgets.

Jezero uses the installed 20 m CTX crop when supported. Gale and InSight use coarse
MOLA (0.0625° cells, approximately 3.7 km north–south) and exceed the default EVA
budgets in the checked scenarios. Routes are calculated on demand; unsupported
terrain returns an error rather than a connecting line.

In Marswalk mode, Overview, Topography and Geology show selectable evidence rings:
red means the endpoint DEM-derived slope exceeds the configured mobility limit;
yellow means missing terrain support or unresolved sub-cell/environmental hazards;
green identifies the planned science objective, **not safe terrain**. A successful
route also marks its steepest sampled terrain cell. Evidence is based on existing
terrain inspection and route results, not imagery interpretation. Markers identify
sampled points, not complete hazard footprints. In 3D, the same evidence is
available through buttons below the map; spatial hazard markers are not rendered.

Resource and duration failures are model-based mission concerns, not geographic
measurements. They appear before secondary mission details. Existing historical
environmental references remain available, but there is no local current weather,
dust storm, radiation dose, obstacle, footing or suit-performance assessment.
