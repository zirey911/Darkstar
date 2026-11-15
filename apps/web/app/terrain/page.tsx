"use client";

import Link from "next/link";
import { saveGuideContext, clearGuideContext, saveMapMode } from "../guide-context";
import Environment from "./Environment";
import Geology from "./Geology";
import Terrain3D from "./Terrain3D";
import type {MissionMarker} from "./MissionAwareness";
import Marswalk, { type WalkSample } from "./Marswalk";
import { landmarks } from "./landmarks";
import { useEffect, useRef, useState } from "react";

type Point = { lat: number; lon: number };
type Sample = Point & { elevation_m: number; distance_m: number; slope_deg: number };
type Result = {
  profile: Sample[]; distance_m: number; ascent_m: number; descent_m: number;
  max_terrain_slope_deg: number; energy_wh?: number; braking_loss_j?: number; energy_capacity_fraction?: number; within_energy_capacity?: boolean; optimization?: string; comparisons?: Comparison[]; comparison_error?: string; nominal_cell_m: number;
  snapping_m: { start: number; end: number }; coarse_to_fine: boolean;
  dataset?: string; dataset_id?: string; fallback_reason?: string | null;
  limitations: string[]; unsupported_fraction: number;
};
type Comparison = { optimization: string; distance_m: number; ascent_m: number; descent_m: number; energy_wh: number; max_terrain_slope_deg: number; effective_max_slope_deg: number; within_energy_capacity: boolean; dataset: string; nominal_cell_m: number; coarse_to_fine: boolean };
const roverPresets = {
  scout: { mass_kg: 200, rolling_resistance: .05, drivetrain_efficiency: .7, energy_capacity_wh: 1000, max_slope_deg: 15 },
  carrier: { mass_kg: 1000, rolling_resistance: .08, drivetrain_efficiency: .65, energy_capacity_wh: 5000, max_slope_deg: 12 },
};
type Inspection = {
  coordinate: Point; cell_centre: Point; elevation_m: number | null;
  observations: number | null; support: string; slope_deg: number | null;
  routing_supported: boolean; nominal_cell_m: number; datum: string;
  dataset?: string; dataset_id?: string; fallback_reason?: string | null;
};
type Region = { id: string; dataset: string; bounds: [number, number, number, number]; source_resolution_m: number };
type Metadata = { regions?: Region[]; provenance: { dataset: string; elevation_datum: string; prepared_utc: string }; nominal_cell_m: number };
const wrap = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
// Display east-positive longitude; API and map geometry stay in [-180, 180).
const east = (lon: number) => Number((((lon % 360) + 360) % 360).toFixed(8)) % 360;
const longitude = (lon: number, digits = 4) => (Number(east(lon).toFixed(digits)) % 360).toFixed(digits);
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));

export default function Terrain() {
  const [planner,setPlanner] = useState<"rover"|"marswalk">("rover");
  const [missionMarkers,setMissionMarkers]=useState<MissionMarker[]>([]);
  const [selectedMissionMarker,setSelectedMissionMarker]=useState<string|null>(null);
  const missionMarker=planner === "marswalk" ? missionMarkers.find(p=>p.id===selectedMissionMarker) : undefined;
  const [missionProfile,setMissionProfile] = useState<WalkSample[]|null>(null);
  const [locationQuery, setLocationQuery] = useState("");
  const [landmark, setLandmark] = useState<(typeof landmarks)[number] | null>(null);
  const [landmarkOpen, setLandmarkOpen] = useState(false);
  function visitLandmark(query: string) {
    const location = landmarks.find(p => p.name.toLowerCase() === query.trim().toLowerCase());
    if (!location) return;
    setLandmark(location);
    setLandmarkOpen(false);
    setCentre({lat: location.lat, lon: wrap(location.lon)});
    setZoom(location.zoom);
    setCursor(null);
    setImageryError(false);
  }
  const [start, setStart] = useState<Point | null>({ lat: 60, lon: 30 });
  const [end, setEnd] = useState<Point | null>({ lat: 61, lon: 32 });
  const [selecting, setSelecting] = useState<"start" | "end" | "inspect">("inspect");
  const [layer, setLayer] = useState<"tiles" | "topography" | "3d" | "geology">("tiles");
  const [geologyPoint,setGeologyPoint]=useState<Point|null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState("");
  const [cursor, setCursor] = useState<Point | null>(null);
  const [grid, setGrid] = useState(true);
  const inspectRequest = useRef<AbortController | null>(null);
  const map = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; lon: number; lat: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState(0);
  const [centre, setCentre] = useState<Point>({ lat: 0, lon: 0 });
  const [limit, setLimit] = useState(15);
  const [preset, setPreset] = useState("scout");
  const [rover, setRover] = useState(roverPresets.scout);
  const [optimization, setOptimization] = useState("distance");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [tileRevision, setTileRevision] = useState(0);
  const [imageryError, setImageryError] = useState(false);
  const [colorBaseLoaded, setColorBaseLoaded] = useState<number[]>([]);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [dataError, setDataError] = useState("");
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    fetch("/api/terrain/metadata", { signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      setMetadata(data);
    }).catch(e => { if (!abort.signal.aborted) setDataError(e.message); });
    return () => { abort.abort(); controller.current?.abort(); inspectRequest.current?.abort(); };
  }, []);

  useEffect(()=>{saveMapMode(layer);},[layer]);
  const width = 360 / 2 ** zoom, height = width / 2;
  const west = centre.lon - width / 2;
  const north = clamp(centre.lat + height / 2, -90 + height, 90);
  useEffect(() => {
    const element = map.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (event.deltaY === 0) return;
      const rect = element!.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const next = clamp(zoom - clamp(event.deltaY, -100, 100) * .003, 0, 12);
      const nextWidth = 360 / 2 ** next, nextHeight = nextWidth / 2;
      setCentre({ lon: wrap(west + x * width + (.5 - x) * nextWidth),
        lat: clamp(north - y * height + (y - .5) * nextHeight, -90 + nextHeight / 2, 90 - nextHeight / 2) });
      setZoom(next);
      setImageryError(false);
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [zoom, west, north, width, height, layer]);
  function mapPoint(clientX: number, clientY: number): Point {
    const rect = map.current!.getBoundingClientRect();
    return { lon: wrap(Number((west + (clientX - rect.left) / rect.width * width).toFixed(4))),
      lat: Number(clamp(north - (clientY - rect.top) / rect.height * height, -90, 90).toFixed(4)) };
  }
  async function inspect(point: Point) {
    clearGuideContext("location");
    setGeologyPoint(point);
    inspectRequest.current?.abort();
    const abort = new AbortController(); inspectRequest.current = abort;
    setInspection(null); setInspectError(""); setInspecting(true);
    const timeout = setTimeout(() => abort.abort(), 20000);
    try {
      const response = await fetch("/api/terrain/inspect", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(point), signal: abort.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      if (inspectRequest.current === abort) {setInspection(data);saveGuideContext("location",data.chat_context);}
    } catch (e) {
      if (inspectRequest.current === abort) setInspectError(abort.signal.aborted ? "Terrain inspection timed out." : e instanceof Error ? e.message : "Terrain inspection failed.");
    } finally { clearTimeout(timeout); if (inspectRequest.current === abort) setInspecting(false); }
  }
  function choose(point: Point) {
    void inspect(point);
    if (selecting !== "inspect") {
      updatePoint(selecting, point);
      setSelecting(selecting === "start" ? "end" : "inspect");
    }
  }
  const tileZoom = Math.min(7, Math.floor(zoom) + 1);
  const ctxZoom = Math.min(12, Math.floor(zoom) + 1);
  function visibleTiles(level: number) {
    const span = 180 / 2 ** level, result = [];
    for (let row = Math.max(0, Math.floor((90 - north) / span)); row < Math.min(2 ** level, Math.ceil((90 - north + height) / span)); row++) {
      for (let col = Math.floor((west + 180) / span); col < Math.ceil((west + 180 + width) / span); col++) {
        result.push({row, col: ((col % 2 ** (level + 1)) + 2 ** (level + 1)) % 2 ** (level + 1), worldCol: col, x: -180 + col * span, y: -90 + row * span, span});
      }
    }
    return result;
  }
  const tiles = visibleTiles(tileZoom);
  function invalidate() {
    clearGuideContext("route", "marswalk");
    requestId.current++;
    controller.current?.abort();
    setPending(false); setResult(null); setMissionProfile(null); setError("");
  }
  function updatePoint(which: "start" | "end", point: Point) {
    invalidate();
    (which === "start" ? setStart : setEnd)(point);
  }
  async function calculate() {
    if (!start || !end) return;
    invalidate();
    const id = requestId.current;
    const abort = new AbortController(); controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 40000);
    setPending(true);
    try {
      const response = await fetch("/api/terrain/route", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, end, max_slope_deg: limit, rover: {...rover, max_slope_deg: limit}, optimization, compare: true }), signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail);
      if (requestId.current === id) {
        setResult(data);
        saveGuideContext("route",data.chat_context);
        // Include native-grid snapping and terrain detours, not just clicked endpoints.
        // Unwrap around the start so seam-crossing routes retain a regional frame.
        const points: Point[] = [start, end, ...data.profile];
        const xs = points.map(p => start.lon + wrap(p.lon - start.lon));
        const ys = points.map(p => p.lat);
        const left = Math.min(...xs), right = Math.max(...xs);
        const bottom = Math.min(...ys), top = Math.max(...ys);
        const extent = Math.max((right - left) * 1.4, (top - bottom) * 2.8, 0.087890625);
        setZoom(clamp(Math.log2(360 / extent), 0, 12));
        setCentre({ lon: wrap((left + right) / 2), lat: (bottom + top) / 2 });
      }
    } catch (e) {
      if (requestId.current === id) setError(abort.signal.aborted ? "Route request timed out. Try closer endpoints." : e instanceof Error ? e.message : "Route failed.");
    } finally { clearTimeout(timeout); if (requestId.current === id) setPending(false); }
  }
  const profile = planner === "marswalk" ? missionProfile || [] : result?.profile || [];
  const low = profile.length ? Math.min(...profile.map(p => p.elevation_m)) : 0;
  const high = profile.length ? Math.max(...profile.map(p => p.elevation_m)) : 1;
  // Unwrap successive route vertices, then repeat world copies across the seam.
  const unwrapped: Sample[] = [];
  for (const sample of profile) {
    const previous = unwrapped[unwrapped.length - 1];
    unwrapped.push({ ...sample, lon: previous ? previous.lon + wrap(sample.lon - previous.lon) : sample.lon });
  }
  const routeShift = unwrapped.length ? 360 * Math.round((centre.lon - unwrapped[0].lon) / 360) : 0;
  const copies = [-360, 0, 360];
  function resetEndpoints() {
    invalidate(); setStart(null); setEnd(null); setSelecting("start");
  }

  return <main className="terrain-shell">
    <header className="masthead"><h1>Mars Explorer</h1><nav aria-label="Main navigation" className="app-nav"><Link href="/terrain" aria-current="page">Explorer</Link><Link href="/">AI survival chat ↗</Link></nav></header>
    <div className="explorer-layerbar">
      <div className="layer-switch" aria-label="Map layers">
        <button aria-pressed={layer === "tiles"} onClick={() => { if(layer !== "tiles") setColorBaseLoaded([]); setLayer("tiles"); setImageryError(false); }}>Overview</button>
        <button aria-pressed={layer === "topography"} onClick={() => { setLayer("topography"); setImageryError(false); }}>Topography</button>
        <button aria-pressed={layer === "geology"} onClick={()=>{setLayer("geology");setImageryError(false);}}>Geology</button>
        <button aria-pressed={layer === "3d"} onClick={() => setLayer("3d")}>3D Terrain</button>
      </div>
      <button className="secondary" disabled={layer === "3d"} aria-pressed={grid} onClick={() => setGrid(!grid)}>Coordinate grid</button>
      <span className="eyebrow">{layer === "tiles" ? "COLORIZED VIKING + CTX DETAIL" : layer === "3d" ? "NUMERICAL DEM · 3D RELIEF" : layer === "geology" ? "USGS · GEOLOGICAL UNITS" : "MOLA / CTX · ELEVATION"}</span>
    </div>
    <form className="landmark-picker" onSubmit={e => { e.preventDefault(); visitLandmark(locationQuery); }}>
      <label htmlFor="landmark-search">Find a landmark</label>
      <input id="landmark-search" type="search" list="mars-landmarks" autoComplete="off" placeholder="Search Mars locations…" value={locationQuery} onChange={e => { setLocationQuery(e.target.value); visitLandmark(e.target.value); }} />
      <datalist id="mars-landmarks">{landmarks.map(p => <option key={p.name} value={p.name} />)}</datalist>
      <button className="secondary" type="submit" disabled={!landmarks.some(p => p.name.toLowerCase() === locationQuery.trim().toLowerCase())}>Go</button>
      {landmark && <span role="status"><a href={`https://planetarynames.wr.usgs.gov/Feature/${landmark.feature}`} title="USGS Gazetteer feature center">{landmark.name}</a> · {Math.abs(landmark.lat).toFixed(2)}° {landmark.lat < 0 ? "S" : "N"}, {longitude(landmark.lon, 2)}° E{layer === "3d" && " · regional 3D patch"}</span>}
    </form>
<div className="map-shortcuts">      {(metadata?.regions || []).map(region => <button className="secondary" key={region.id} onClick={() => { const [w,s,e,n] = region.bounds; setCentre({lat:(s+n)/2,lon:(w+e)/2}); setZoom(9); if(layer !== "3d") setLayer("topography"); setImageryError(false); }}>Explore Jezero · {region.source_resolution_m} m</button>)}
      <button className="secondary" onClick={() => { if (start) setCentre(start); setZoom(5); setImageryError(false); }} disabled={!start}>Focus start</button>
</div>
    <div className="explorer-modes"><button className="secondary" aria-pressed={selecting === "start"} onClick={() => setSelecting("start")}>{planner === "marswalk" ? "Set habitat" : "Set start"}</button><button className="secondary" aria-pressed={selecting === "end"} onClick={() => setSelecting("end")}>{planner === "marswalk" ? "Set science stop" : "Set destination"}</button><button className="secondary" aria-pressed={selecting === "inspect"} onClick={() => setSelecting("inspect")}>Inspect terrain</button><span>Drag to pan · Scroll to zoom · Click to {selecting === "inspect" ? "inspect" : `set ${selecting}`} · Arrow keys pan, Enter inspects the centre</span></div>
    <div className="map-frame">
    <div className="map-navigation" aria-label="Map navigation">
      <div className="direction-pad">
        <button className="north" aria-label="North" title="Pan north" onClick={() => setCentre({lat:clamp(layer === "3d" ? centre.lat+Math.min(12,width)/4 : north,-90,90),lon:centre.lon})}>↑</button>
        <button className="west" aria-label="West" title="Pan west" onClick={() => setCentre({...centre,lon:wrap(centre.lon-(layer === "3d" ? Math.min(12,width) : width)/2)})}>←</button>
        <button className="global" title="Reset planetary view" onClick={() => {setCentre({lat:0,lon:0});setZoom(0);if(layer !== "tiles")setColorBaseLoaded([]);setLayer("tiles");}}>Global</button>
        <button className="east" aria-label="East" title="Pan east" onClick={() => setCentre({...centre,lon:wrap(centre.lon+(layer === "3d" ? Math.min(12,width) : width)/2)})}>→</button>
        <button className="south" aria-label="South" title="Pan south" onClick={() => setCentre({lat:clamp(layer === "3d" ? centre.lat-Math.min(12,width)/4 : north-height,-90,90),lon:centre.lon})}>↓</button>
      </div>
      <div className="zoom-pad"><button aria-label="Zoom in" title="Zoom in" disabled={zoom===12} onClick={() => setZoom(Math.min(12,zoom+1))}>+</button><button aria-label="Zoom out" title="Zoom out" disabled={zoom===0} onClick={() => setZoom(Math.max(0,zoom-1))}>−</button></div>
    </div>
    {layer === "3d" ? <Terrain3D centre={centre} span={Math.min(12,Math.max(.02,width))} start={start} end={end} endpointLabels={planner === "marswalk" ? ["H","SCI"] : undefined} route={profile} onSelect={choose} landmark={landmark} onLandmarkClick={()=>setLandmarkOpen(true)} /> : <svg ref={map} style={{isolation:"isolate"}} className="mars-map" viewBox={`${west} ${-north} ${width} ${height}`} role="img" tabIndex={0} aria-label="Global Mars map with selectable start and destination"
      onPointerDown={event => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, y: event.clientY, lon: west + width / 2, lat: north - height / 2, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        setCursor(mapPoint(event.clientX, event.clientY));
        if (!drag.current || event.buttons === 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
        if (Math.hypot(dx, dy) > 4) drag.current.moved = true;
        if (drag.current.moved) setCentre({ lon: wrap(drag.current.lon - dx / rect.width * width), lat: clamp(drag.current.lat + dy / rect.height * height, -90 + height / 2, 90 - height / 2) });
      }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerLeave={() => setCursor(null)}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); choose({ lat: north - height / 2, lon: wrap(west + width / 2) }); }
        else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
          event.preventDefault(); setCentre({ lon: wrap(west + width / 2 + (event.key === "ArrowRight" ? width / 4 : event.key === "ArrowLeft" ? -width / 4 : 0)), lat: clamp(north - height / 2 + (event.key === "ArrowUp" ? height / 4 : event.key === "ArrowDown" ? -height / 4 : 0), -90, 90) });
        }
      }}
      onClick={event => {
        if (drag.current?.moved) { drag.current = null; return; }
        drag.current = null; choose(mapPoint(event.clientX, event.clientY));
      }}>
      <title>{`Mars ${layer === "tiles" ? "colorized Viking with CTX detail (not natural color)" : "MOLA topography"}, equirectangular projection`}</title>
      <rect x={west} y={-north} width={width} height={height} fill="#222a2d" />
      {/* Real low-zoom tiles stay underneath while finer tiles arrive. */}
      {layer !== "geology" && <>
      {copies.flatMap(offset => [0, 1].map(col => <image key={`overview/${tileRevision}/${layer}/${offset}/${col}`} href={`/api/terrain/${layer}/0/0/${col}?retry=${tileRevision}`} x={-180 + col * 180 + offset} y={-90} width={180} height={180} onLoad={() => { if(layer === "tiles") setColorBaseLoaded(loaded => loaded.includes(col) ? loaded : [...loaded,col]); }} onError={() => {setImageryError(true); if(layer === "tiles")setColorBaseLoaded(loaded=>loaded.filter(c=>c!==col));}} />))}
      {tiles.map(t => <image key={`${tileRevision}/${layer}/${tileZoom}/${t.row}/${t.worldCol}`} href={`/api/terrain/${layer}/${tileZoom}/${t.row}/${t.col}?retry=${tileRevision}`} x={t.x} y={t.y} width={t.span} height={t.span} onError={() => setImageryError(true)} />)}
      {/* One blended group: parent/detail tiles replace each other without stacking color effects.
          Wait for the complete color backdrop; never show raw gray tiles while it loads. */}
      {layer === "tiles" && zoom > 4 && colorBaseLoaded.length === 2 && <g className="ctx-color-detail" opacity={Math.min(.85,(zoom-4)*.425)}>
      {[...new Set([Math.max(0, ctxZoom - 2), ctxZoom])].map(level => <g key={`ctx/${tileRevision}/${level}`}>
        {visibleTiles(level).filter(t => t.y < 88 && t.y + t.span > -88).map(t => <image key={`${t.row}/${t.worldCol}`} href={`/api/terrain/ctx/${level}/${t.row}/${t.col}?retry=${tileRevision}`} x={t.x} y={t.y} width={t.span} height={t.span}
          onLoad={e => { e.currentTarget.style.visibility = "visible"; }}
          onError={e => { e.currentTarget.style.visibility = "hidden"; setImageryError(true); }} />)}
      </g>)}
      </g>}
      </>}
      {layer === "geology" && [...new Set([2,Math.min(6,Math.floor(zoom)+2)])].flatMap(level=>{
        const span=360/2**level;const images=[];
        for(let row=Math.max(2**(level-2),Math.floor((180-north)/span));row<Math.min(3*2**(level-2),Math.ceil((180-north+height)/span));row++){
          for(let col=Math.floor((west+180)/span);col<Math.ceil((west+180+width)/span);col++){
            const wrapped=((col%2**level)+2**level)%2**level;
            images.push(<image key={`geology/${tileRevision}/${level}/${row}/${col}`} href={`/api/terrain/geology/${level}/${row}/${wrapped}?retry=${tileRevision}`} x={-180+col*span} y={-180+row*span} width={span} height={span} onError={e=>{e.currentTarget.style.visibility="hidden";setImageryError(true);}}/>);
          }
        }return images;
      })}
      {grid && Array.from({ length: Math.ceil(width / 30) + 2 }, (_, i) => Math.floor(west / 30) * 30 + i * 30).map(lon => <line key={`lon${lon}`} x1={lon} x2={lon} y1={-90} y2={90} stroke="#fff" opacity=".2" strokeWidth={width / 1000} />)}
      {grid && Array.from({ length: 7 }, (_, i) => -90 + i * 30).map(lat => <line key={`lat${lat}`} x1={west} x2={west + width} y1={lat} y2={lat} stroke="#fff" opacity=".2" strokeWidth={width / 1000} />)}
      {copies.map(offset => <g key={offset}>
        {(metadata?.regions || []).map(region => <g key={region.id}>
          {layer === "topography" && zoom >= 7 && <image href={`/api/terrain/region-map?retry=${tileRevision}`} x={region.bounds[0]+offset} y={-region.bounds[3]} width={region.bounds[2]-region.bounds[0]} height={region.bounds[3]-region.bounds[1]} preserveAspectRatio="none" onError={() => setImageryError(true)} />}
          <rect x={region.bounds[0]+offset} y={-region.bounds[3]} width={region.bounds[2]-region.bounds[0]} height={region.bounds[3]-region.bounds[1]} fill="none" stroke="#f9d77e" strokeWidth={width/700} strokeDasharray={`${width/250} ${width/400}`} />
          {zoom < 7 && <circle cx={(region.bounds[0]+region.bounds[2])/2+offset} cy={-(region.bounds[1]+region.bounds[3])/2} r={width/160} fill="#f9d77e" />}
        </g>)}
        {unwrapped.length > 0 && <polyline points={unwrapped.map(p => `${p.lon + routeShift + offset},${-p.lat}`).join(" ")} fill="none" stroke="#70f3cf" strokeWidth={width / 300} />}
        {([{ point: start, label: planner === "marswalk" ? "H" : "S", color: '#f3c18d' }, { point: end, label: planner === "marswalk" ? "SCI" : "D", color: '#a8d9ff' }]).map(({point, label, color}) => point && <g key={label}><circle cx={point.lon + offset} cy={-point.lat} r={width / 90} fill={color} stroke="#101519" strokeWidth={width / 600} /><text x={point.lon + offset} y={-point.lat + width / 240} textAnchor="middle" fontSize={width / 80} fill="#101519">{label}</text></g>)}
        {planner === "marswalk" && missionMarkers.map(p=><g key={p.id} role="button" tabIndex={0} aria-label={`Inspect ${p.title}`} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setSelectedMissionMarker(p.id);}} onKeyDown={e=>{e.stopPropagation();if(e.key==="Enter"||e.key===" "){e.preventDefault();setSelectedMissionMarker(p.id);}}}>
          <circle cx={wrap(p.lon)+offset} cy={-p.lat} r={width/(p.level==="green"?150:65)} fill={p.level==="green"?"#72e69b":"none"} stroke={p.level==="red"?"#ff6868":p.level==="yellow"?"#f9d77e":"#72e69b"} strokeWidth={width/400}/><title>{p.title}</title>
        </g>)}
        {landmark && wrap(landmark.lon)+offset >= west && wrap(landmark.lon)+offset <= west+width && <g className="landmark-map-pin" role="button" tabIndex={0} aria-label={`Show ${landmark.name}`} transform={`translate(${wrap(landmark.lon)+offset} ${-landmark.lat}) scale(${width/800})`}
          onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setLandmarkOpen(true);}}
          onKeyDown={e=>{e.stopPropagation();if(e.key === "Enter" || e.key === " "){e.preventDefault();setLandmarkOpen(true);}}}>
          <path d="M0 0 L-10 -17 A12 12 0 1 1 10 -17 Z" fill="#e7baff" stroke="#241a32" strokeWidth="2" />
          <circle cx="0" cy="-23" r="4" fill="#462266" />
          <text x="16" y="-20" fontSize="13" fontWeight="bold" fill="#f0d5ff" stroke="#101519" strokeWidth="3" paintOrder="stroke">{landmark.name}</text>
        </g>}
        {inspection && <circle cx={inspection.coordinate.lon + offset} cy={-inspection.coordinate.lat} r={width / 110} fill="none" stroke="white" strokeWidth={width / 500} />}
      </g>)}
    </svg>}
    {missionMarker&&<div className="landmark-popup" role="dialog" aria-label="Mission marker evidence"><strong>{missionMarker.title}</strong><span>{missionMarker.evidence}</span><a href={missionMarker.source}>Supporting source</a><button aria-label="Close mission evidence" onClick={()=>setSelectedMissionMarker(null)}>×</button></div>}
    {landmarkOpen && landmark && <div className="landmark-popup" role="dialog" aria-label="Landmark details"><strong>{landmark.name}</strong><span>{Math.abs(landmark.lat).toFixed(2)}° {landmark.lat < 0 ? "S" : "N"}, {longitude(landmark.lon,2)}° E</span><button aria-label="Close landmark details" onClick={()=>setLandmarkOpen(false)}>×</button></div>}
    <div className="map-readout">{cursor ? `${cursor.lat.toFixed(3)}° N / ${longitude(cursor.lon, 3)}° E` : 'PLANETOCENTRIC · LONGITUDE 0–360° E'}<span>ZOOM {zoom.toFixed(1)} / 12</span></div>
    </div>
    {planner==="marswalk"&&<div className="route-actions" aria-label="Mission map evidence"><span>Red: slope limit · Yellow: uncertainty · Green: objective</span>{layer==="3d"&&<span>Evidence markers are shown on 2D maps; inspect the same evidence here.</span>}{missionMarkers.map(p=><button className="secondary" key={p.id} onClick={()=>setSelectedMissionMarker(p.id)}>{p.title}</button>)}</div>}
    <p className="map-data-summary">{layer === "geology" ? "USGS geological units · Global · 1:20,000,000 (not outcrop resolution)" : layer === "tiles" ? "Colorized composite, not natural color · Viking + CTX imagery" : layer === "topography" ? "Elevation · MOLA global / CTX regional" : "Numerical elevation · regional 3D terrain"}{layer !== "3d" && <> · MOLA {metadata ? `${metadata.nominal_cell_m.toFixed(0)} m` : "≈3.7 km"}{metadata?.regions?.length ? " · Jezero CTX 20 m (gold outline)" : ""}</>}</p>
    {layer === "topography" && <div className="topography-legend"><div /><p><span>−8,177 m</span><span>0 m</span><span>21,171 m</span></p></div>}
    {layer === "topography" && zoom >= 7 && metadata?.regions?.some(region => region.bounds[0] <= east(west)+width && region.bounds[2] >= east(west) && region.bounds[1] <= north && region.bounds[3] >= north-height) && <p className="resolution-notice">Jezero crop: local color scale −3,000 to −2,000 m; gaps show coarse MOLA beneath.</p>}
    {Math.abs(centre.lat) > 80 && <p className="resolution-notice">Polar view is stretched; routing beyond ±80° is unsupported.</p>}
    <details className="data-details"><summary>Data Details · map & sources</summary>
    <p className="map-resolution">{layer === "tiles" ? 'Viking global color with CTX grayscale brightness detail at closer zooms. CTX sampling reaches ≈5.09 m; color stays at Viking’s much coarser resolution (nominal 232 m mosaic). If detail fails, Viking remains. Imagery is not elevation.' : 'MOLA global elevation: 3.7 km north–south cells.'} {metadata?.regions?.length ? "Detailed CTX elevation is available only inside the gold Jezero footprint; elsewhere MOLA remains the fallback." : "No detailed DEM is installed; global MOLA is the elevation source."} Sub-cell obstacles are unresolved. Equirectangular view stretches polar regions; poles can be inspected, but routing beyond ±80° is unsupported.</p>
<p>Topography elevations reference the MOLA areoid. Dimmed pixels are interpolated or unsupported; they are excluded from routing. Zooming does not increase source resolution.</p>
    {(metadata?.regions || []).length > 0 && <p className="map-resolution">Gold outline: installed Jezero CTX 20 m crop. The rectangle marks bounds, not guaranteed valid pixels. At zoom 7+, topography inside it uses a local −3,000 to −2,000 m color scale; nodata stays transparent over the coarse global layer. Inspection and routes always identify the actual dataset.</p>}
    <p className="footnote">View: {longitude(west, 2)}° to {longitude(west + width, 2)}° E (eastward, wrapped; span {width.toFixed(2)}°); {(north - height).toFixed(2)}° to {north.toFixed(2)}° N. Imagery: NASA/JPL/MSSS/Caltech Murray Lab, hosted by <a href="https://www.arcgis.com/home/item.html?id=30c4acfe36284b1784bf07d5d73f9e4d">Esri · CTX V01</a>. Colorized Viking MDIM 2.1 basemap via NASA Mars Trek; CTX supplies brightness detail only. Colors are illustrative, not 5 m color measurements. Mosaic gaps, seams and registration offsets can occur; imagery is not current conditions or precise ground control.</p>
    <p>Global MOLA cells are about 3.7 km north–south; the optional Jezero CTX crop has 20 m cells. Routes never blend the two datasets. Rocks, sand, cliffs and small craters can be invisible at this scale. Unsupported cells are blocked, never filled with invented routes. The route is exploratory, not operational navigation.</p>{metadata && <p className="footnote">{metadata.provenance.dataset}. Datum: {metadata.provenance.elevation_datum}. <a href="https://pds-geosciences.wustl.edu/missions/mgs/megdr.html">NASA PDS data and provenance ↗</a></p>}
    </details>
    {layer === "geology" && <Geology point={geologyPoint}/>}
    {imageryError && <p role="alert" className="error">{layer === "geology" ? "Some geology tiles are unavailable; coarse geology remains where loaded." : "Some map tiles are unavailable; coarse CTX or Viking imagery remains where loaded."} Coordinate selection still works; blank areas are not evidence of safe terrain. <button className="secondary" onClick={() => { setImageryError(false); setColorBaseLoaded([]); setTileRevision(v => v + 1); }}>Retry map tiles</button></p>}
    {dataError && <p role="alert" className="error">{dataError}</p>}
    <div className="explorer-layerbar" aria-label="Mission planning">
      <strong>Route planner</strong>
      <div className="layer-switch" role="group" aria-label="Planner mode">
        <button type="button" aria-pressed={planner === "rover"} onClick={()=>{if(planner !== "rover"){invalidate();setPlanner("rover");setSelecting("inspect");}}}>Rover</button>
        <button type="button" aria-pressed={planner === "marswalk"} onClick={()=>{if(planner !== "marswalk"){invalidate();setPlanner("marswalk");setSelecting("inspect");}}}>Marswalk</button>
      </div>
    </div>
    <div hidden={planner !== "marswalk"}><Marswalk onMarkers={setMissionMarkers} onMissionExample={example=>{invalidate();setStart(example.start);setEnd(example.end);setCentre({lat:(example.start.lat+example.end.lat)/2,lon:(example.start.lon+example.end.lon)/2});setZoom(example.zoom);setSelecting("inspect");setSelectedMissionMarker(null);}} active={planner === "marswalk"} start={start} end={end} onProfile={setMissionProfile} onDestination={point=>{updatePoint("end",point);setCentre(point);setZoom(7);setSelecting("inspect");void inspect(point);}} onExample={()=>{invalidate();setStart({lat:18.4447,lon:77.4508});setEnd({lat:18.45,lon:77.46});setCentre({lat:18.447,lon:77.455});setZoom(12);setSelecting("inspect");}}/></div>
    {planner === "rover" && <>
    <div className="route-heading"><h2>Route planner</h2><p>Choose endpoints and a rover scenario.</p></div>
    <div className="route-actions">{(metadata?.regions || []).length > 0 && <button className="secondary" onClick={() => { invalidate(); setStart({lat:18.4447,lon:77.4508}); setEnd({lat:18.45,lon:77.46}); setCentre({lat:18.447,lon:77.455}); setZoom(12); setLayer("topography"); }}>Load Jezero route</button>}<button className="secondary" onClick={resetEndpoints}>Reset endpoints</button><button className="secondary" disabled={!start || !end} onClick={() => { invalidate(); setStart(end); setEnd(start); }}>Swap endpoints</button><button className="secondary" onClick={() => { invalidate(); setStart({lat:60,lon:30}); setEnd({lat:61,lon:32}); setSelecting("inspect"); setCentre({lat:60.5,lon:31}); setZoom(5); }}>Load example</button></div>
    <form className="route-controls" onSubmit={e => { e.preventDefault(); void calculate(); }}>
      {(['start', 'end'] as const).map(which => <fieldset key={which}><legend>{which === 'start' ? 'Start (S)' : 'Destination (D)'}</legend>
        <button type="button" className="secondary" aria-pressed={selecting === which} onClick={() => setSelecting(which)}>Select {which} on map</button>
        {(['lat', 'lon'] as const).map(axis => <label key={axis}>{which} {axis === 'lat' ? 'latitude' : 'longitude'}<input type="number" step="any" required min={axis === 'lat' ? -90 : 0} max={axis === 'lat' ? 90 : 360} value={(which === 'start' ? start : end) ? (axis === "lon" ? east((which === "start" ? start : end)?.lon ?? 0) : (which === "start" ? start : end)?.lat) : ""} onChange={e => { if (e.target.value === "") { invalidate(); (which === "start" ? setStart : setEnd)(null); } else updatePoint(which, { ...((which === "start" ? start : end) ?? {lat:0,lon:0}), [axis]: axis === "lon" ? wrap(Number(e.target.value)) : Number(e.target.value) }); }} /></label>)}
      </fieldset>)}
      <fieldset><legend>Rover scenario</legend>
        <label>Rover profile<select value={preset} onChange={e => { invalidate(); setPreset(e.target.value); const value = roverPresets[e.target.value as keyof typeof roverPresets]; if (value) {setRover(value); setLimit(value.max_slope_deg);} }}><option value="scout">Scout — hypothetical</option><option value="carrier">Carrier — hypothetical</option><option value="custom">Custom scenario</option></select></label>
        {([
          ["mass_kg", "Mass (kg)", .1, 100000, .1],
          ["rolling_resistance", "Rolling resistance coefficient", 0, 1, .01],
          ["drivetrain_efficiency", "Drivetrain efficiency (0–1)", .01, 1, .01],
          ["energy_capacity_wh", "Available traction energy (Wh)", .1, 10000000, .1],
        ] as const).map(([key, label, min, max, step]) => <label key={key}>{label}<input type="number" required min={min} max={max} step={step} value={rover[key]} onChange={e => { invalidate(); setPreset("custom"); setRover({...rover, [key]: Number(e.target.value)}); }} /></label>)}
        <label>Maximum slope (degrees)<input type="number" min="0.1" max="35" step="0.1" required value={limit} onChange={e => { invalidate(); setPreset("custom"); setLimit(Number(e.target.value)); }} /></label>
        <label>Route optimization<select value={optimization} onChange={e => { invalidate(); setOptimization(e.target.value); }}><option value="distance">Shortest distance</option><option value="energy">Lowest estimated energy</option></select></label>
        <details className="data-details"><summary>Data Details · rover assumptions</summary><p>Routes support up to 600 km, 12° longitude span, within ±80° latitude. Longitudes use 0–360° E; 360° equals 0°.</p><p>Hypothetical profiles, not NASA rover specifications. Constant gravity 3.71 m/s²; rolling resistance and efficiency are assumptions. No regeneration, slip, steering, heating or electronics. Capacity is the available traction budget only.</p></details>
        <button className="send" disabled={pending || !!dataError || !start || !end} type="submit">{pending ? 'Finding route…' : 'Calculate route'}</button></fieldset>
    </form>
    {pending && <p role="status">Reading regional terrain and searching for a traversable route…</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {result && <section className="route-result" aria-label="Route result">
      <p className="dataset-badge">{result.dataset || 'NASA MOLA'} · {result.nominal_cell_m.toFixed(0)} m cells</p>
      {result.fallback_reason && <p className="resolution-notice">{result.fallback_reason}</p>}
      <p className="resolution-notice">Exploratory route only; terrain smaller than the DEM cells is unresolved.</p>
      <h2>{(result.distance_m / 1000).toFixed(2)} km regional route</h2>
      <p>Ascent {result.ascent_m.toFixed(0)} m · Descent {result.descent_m.toFixed(0)} m · Maximum terrain slope {result.max_terrain_slope_deg.toFixed(2)}°</p>
      {result.energy_wh !== undefined && <><p><strong>Estimated traction energy: {result.energy_wh.toFixed(2)} Wh</strong> · {((result.energy_capacity_fraction || 0) * 100).toFixed(1)}% of available traction capacity · Braking heat: {((result.braking_loss_j || 0) / 1000).toFixed(2)} kJ</p>{!result.within_energy_capacity && <p className="resolution-notice">Estimated traction demand exceeds the configured capacity. This route is not energy-feasible under these assumptions.</p>}</>}
      {result.comparisons && <div className="route-comparison"><h3>Same endpoints · same rover · two objectives</h3><p className="footnote">Map and profile show {result.optimization === "energy" ? "lowest estimated energy" : "shortest distance"}. Change optimization above to display the other route.</p><table><thead><tr><th>Objective</th><th>Distance</th><th>Ascent / descent</th><th>Traction energy</th><th>Max slope / limit</th><th>Dataset</th></tr></thead><tbody>{result.comparisons.map(row => <tr key={row.optimization}><th>{row.optimization === "energy" ? "Energy" : "Distance"}</th><td>{(row.distance_m / 1000).toFixed(3)} km</td><td>{row.ascent_m.toFixed(1)} / {row.descent_m.toFixed(1)} m</td><td>{row.energy_wh.toFixed(2)} Wh{!row.within_energy_capacity && " · over capacity"}</td><td>{row.max_terrain_slope_deg.toFixed(2)}° / {row.effective_max_slope_deg}°</td><td>{row.dataset} · {row.nominal_cell_m.toFixed(0)} m</td></tr>)}</tbody></table></div>}
      {result.comparison_error && <p className="resolution-notice">{result.comparison_error}</p>}
      <h3>Elevation profile · source DEM vertical reference</h3>
      <svg className="elevation-profile" viewBox="0 0 800 200" role="img" aria-label="Route elevation profile by cumulative distance">
        <line x1="60" x2="780" y1="170" y2="170" stroke="#829298" />
        <text x="5" y="25" fill="#b7c4c8" fontSize="12">{high.toFixed(0)} m</text><text x="5" y="165" fill="#b7c4c8" fontSize="12">{low.toFixed(0)} m</text>
        <polyline points={profile.map(p => `${60 + 720 * p.distance_m / result.distance_m},${160 - 130 * (p.elevation_m - low) / Math.max(1, high - low)}`).join(' ')} fill="none" stroke="#70f3cf" strokeWidth="2" />
        <text x="60" y="190" fill="#b7c4c8" fontSize="12">0 km</text><text x="690" y="190" fill="#b7c4c8" fontSize="12">{(result.distance_m / 1000).toFixed(2)} km</text>
      </svg>
      {result.dataset_id === "mola16" && profile.length > 1 && start && end && Math.abs(wrap(end.lon - start.lon)) > 1e-8 && profile.every(p => Math.abs(wrap(p.lon - profile[0].lon)) < 1e-8) && <p className="resolution-notice">Both selected longitudes snap to the same MOLA grid column, so this computed route runs north–south. Markers show your selected locations; the line ends at DEM cell centres. Sub-cell connections are unvalidated and are not drawn.</p>}
      <p>Start snapped {(result.snapping_m.start / 1000).toFixed(2)} km; destination snapped {(result.snapping_m.end / 1000).toFixed(2)} km. Those connections are not part of the computed grid route.</p>
      <details className="data-details"><summary>Data Details · route</summary>      <p className="footnote">{profile.length} grid centres · {(result.nominal_cell_m / 1000).toFixed(2)} km nominal north–south resolution · {result.coarse_to_fine ? 'Coarse guide, refined on native grid' : 'Native-grid A*'} · {(100 * result.unsupported_fraction).toFixed(1)}% of search cells unsupported</p>      {profile.length > 0 && <p className="footnote">Route grid endpoints: {profile[0].lat.toFixed(4)}° N, {longitude(profile[0].lon)}° E → {profile[profile.length - 1].lat.toFixed(4)}° N, {longitude(profile[profile.length - 1].lon)}° E.</p>}<p>Corridor refinement can limit optimality; identical routes are possible.</p><ul>{result.limitations.map(line => <li key={line}>{line}</li>)}</ul><p>Traction-energy estimates are not measured NASA rover performance or a mission-range prediction.</p></details>
    </section>}
    </>}
    {geologyPoint && <Environment point={geologyPoint}/>}
    <section className="terrain-inspector" aria-label="Terrain inspection">
      <div><p className="eyebrow">TERRAIN INSPECTOR</p><h2>{inspection ? `${inspection.coordinate.lat.toFixed(4)}° N, ${longitude(inspection.coordinate.lon)}° E` : 'What is beneath this point?'}</h2>
        {!inspection && !inspecting && !inspectError && <p>Click the map in inspect mode, or inspect an endpoint.</p>}
        {inspecting && <p role="status">Reading elevation dataset…</p>}
        {inspectError && <p role="alert">{inspectError}</p>}
      </div>
      <div className="inspector-actions"><button className="secondary" disabled={!start} onClick={() => start && void inspect(start)}>Inspect start</button><button className="secondary" disabled={!end} onClick={() => end && void inspect(end)}>Inspect destination</button></div>
      {inspection && <><p className="dataset-badge">{inspection.dataset || 'NASA MOLA'} · {inspection.nominal_cell_m.toFixed(0)} m cells</p>{inspection.fallback_reason && <p className="resolution-notice">{inspection.fallback_reason}</p>}<div className="terrain-metrics inspection-metrics"><div><small>ELEVATION / AREOID</small><strong>{inspection.elevation_m === null ? 'Unavailable' : `${inspection.elevation_m.toLocaleString()} m`}</strong></div><div><small>GRID SLOPE</small><strong>{inspection.slope_deg === null ? 'Unsupported' : `${inspection.slope_deg.toFixed(2)}°`}</strong></div><div><small>DATA SUPPORT</small><strong>{inspection.support}</strong></div></div>{!inspection.routing_supported && <p className="resolution-notice">Not supported for routing: sparse observations, slope stencil or polar limit.</p>}<details className="data-details"><summary>Data Details · inspected terrain</summary><p>Readings come from the active numerical DEM cell, not image color. Datum: {inspection.datum}.</p><p>Observations: <span>{inspection.observations === null ? "Not supplied" : inspection.observations.toLocaleString()}</span></p><p className="footnote">Cell centre {inspection.cell_centre.lat.toFixed(4)}° N, {longitude(inspection.cell_centre.lon)}° E · {(inspection.nominal_cell_m / 1000).toFixed(2)} km north–south. {inspection.routing_supported ? 'Slope is supported; routing also applies your vehicle limit.' : 'Not supported for routing: sparse observations, slope stencil or polar limit.'}</p></details><div className="inspector-actions"><button className="secondary" onClick={() => updatePoint('start', inspection.coordinate)}>Use as start</button><button className="secondary" onClick={() => updatePoint('end', inspection.coordinate)}>Use as destination</button></div></>}
    </section>

  </main>;
}
