"use client";

import { useEffect, useRef, useState } from "react";
import { saveGuideContext, clearGuideContext } from "../guide-context";
import Environment from "./Environment";
import MissionAwareness, {type MissionMarker} from "./MissionAwareness";
import {missionExamples,type MissionExample} from "./mission-examples";
import { scienceDestinations } from "./science-destinations";
import type { Point } from "./terrain-geometry";
export type WalkSample = Point & {elevation_m:number; distance_m:number; slope_deg:number};
type Resource = {used:number;capacity:number;reserve:number;required_capacity:number;remaining:number;sufficient:boolean};
type Mission = {objective:string;legs:{name:string;profile:WalkSample[];distance_m:number;travel_minutes:number;ascent_m:number;descent_m:number;dataset:string;dataset_id:string;nominal_cell_m:number;max_terrain_slope_deg:number}[];phases:{name:string;minutes:number;oxygen_kg:number;power_wh:number}[];total_minutes:number;distance_m:number;budget_distance_m:number;resources:{oxygen_kg:Resource;power_wh:Resource};within_budgets:boolean;warnings:string[]};
const defaults={science_minutes:30,speed_kmh:2,max_slope_deg:15,duration_limit_minutes:240,oxygen_kg:1,power_wh:1000,reserve_fraction:.25,travel_oxygen_kg_h:.15,science_oxygen_kg_h:.1,travel_power_w:250,science_power_w:200};
const fields = [
  ["science_minutes","Science duration (minutes)",0,1440,1],
  ["speed_kmh","Walking speed (km/h)",.1,10,.1],
  ["max_slope_deg","Astronaut maximum slope (degrees)",.1,35,.1],
  ["duration_limit_minutes","Maximum EVA duration (minutes)",1,1440,1],
  ["oxygen_kg","Available oxygen (kg)",.01,100,.01],
  ["power_wh","Available power (Wh)",1,100000,1],
  ["reserve_fraction","Emergency reserve (fraction of each capacity)",0,.9,.05],
  ["travel_oxygen_kg_h","Travel oxygen rate (kg/h)",.001,10,.001],
  ["science_oxygen_kg_h","Science oxygen rate (kg/h)",.001,10,.001],
  ["travel_power_w","Travel power draw (W)",1,10000,1],
  ["science_power_w","Science power draw (W)",1,10000,1],
] as const;
export default function Marswalk({active=true,start,end,onProfile,onExample,onDestination,onMissionExample,onMarkers}:{onMissionExample?:(example:MissionExample)=>void;onMarkers?:(markers:MissionMarker[])=>void;active?:boolean;start:Point|null;end:Point|null;onProfile:(profile:WalkSample[]|null)=>void;onExample:()=>void;onDestination?:(point:Point)=>void}) {
  const [exampleId,setExampleId]=useState("");
  const example=missionExamples.find(e=>e.id===exampleId && e.start.lat===start?.lat && e.start.lon===start?.lon && e.end.lat===end?.lat && e.end.lon===end?.lon);
  const [scienceName,setScienceName]=useState("");
  const selectedScience=scienceDestinations.find(d=>d.name===scienceName && end?.lat===d.lat && end?.lon===d.lon);
  const [settings,setSettings]=useState(defaults);
  const [objective,setObjective]=useState("Photograph and describe exposed sedimentary layers without disturbing the site.");
  const [response,setResponse]=useState<{key:string;mission?:Mission;error?:string}|null>(null);
  const [pendingRequest,setPendingRequest]=useState<{key:string;request:AbortController}|null>(null);
  const [previousActive,setPreviousActive]=useState(active);
  if(previousActive!==active){setPreviousActive(active);setPendingRequest(null);setResponse(null);}
  const controller=useRef<AbortController|null>(null);
  const key=JSON.stringify({start,end,objective,...settings});
  const activeKey=useRef(key);
  const pending=pendingRequest?.key===key && !pendingRequest.request.signal.aborted;
  const mission=response?.key===key?response.mission:undefined;
  const error=response?.key===key?response.error:undefined;
  useEffect(()=>{clearGuideContext("marswalk");activeKey.current=key;onProfile(null);controller.current?.abort();controller.current=null;return()=>controller.current?.abort();},[key,onProfile]);
  useEffect(()=>{if(!active){controller.current?.abort();controller.current=null;}},[active]);
  async function calculate(){
    if(!active||!start||!end)return;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;
    clearGuideContext("marswalk");
    setPendingRequest({key,request:abort});setResponse(null);onProfile(null);
    const timer=setTimeout(()=>abort.abort(),75000);
    try{
      const r=await fetch("/api/terrain/marswalk",{method:"POST",headers:{"Content-Type":"application/json"},body:key,signal:abort.signal});
      const data=await r.json();if(!r.ok)throw new Error(typeof data.detail==="string"?data.detail:"Invalid Marswalk settings.");
      if(activeKey.current!==key||controller.current!==abort)return;
      setResponse({key,mission:data});
      saveGuideContext("marswalk",data.chat_context);
      let offset=0;const samples:WalkSample[]=[];
      for(const leg of (data as Mission).legs){samples.push(...leg.profile.map(p=>({...p,distance_m:p.distance_m+offset})));offset+=leg.distance_m;}
      onProfile(samples);
    }catch(e){if(activeKey.current===key&&controller.current===abort)setResponse({key,error:abort.signal.aborted?"Marswalk request timed out. Try closer points.":e instanceof Error?e.message:"Marswalk failed."});}
    finally{clearTimeout(timer);setPendingRequest(current=>current?.request===abort?null:current);}
  }
  const coordinates=(p:Point|null)=>p?`${Math.abs(p.lat).toFixed(4)}° ${p.lat<0?"S":"N"}, ${((p.lon%360+360)%360).toFixed(4)}° E`:"Select on map";
  return <section className="route-result" aria-label="Marswalk planner">
    <h2>Marswalk mission</h2>
    <p>Habitat (H): {coordinates(start)} · Science stop (SCI): {coordinates(end)}</p>
    <p className="resolution-notice">Hypothetical planning assumptions, not NASA-certified astronaut performance. One astronaut, one science stop, return to habitat.</p>
    {onMarkers&&<MissionAwareness active={active} start={start} end={end} limit={settings.max_slope_deg} route={mission?.legs.flatMap(l=>l.profile.map(p=>({...p,dataset:l.dataset,dataset_id:l.dataset_id,nominal_cell_m:l.nominal_cell_m})))||[]} onMarkers={onMarkers}/>}
    {onMissionExample&&<><label>NASA landing-site mission<select aria-label="NASA landing-site mission" value={example?.id||""} onChange={e=>{const example=missionExamples.find(x=>x.id===e.target.value);setExampleId(e.target.value);if(example){controller.current?.abort();setSettings(defaults);setObjective(example.objective);setResponse(null);onMissionExample(example);}}}><option value="">Choose a mission example</option>{missionExamples.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    {example&&<article><strong>{example.name}</strong><p>{example.importance}</p><p>{example.coverage}</p><p>Reference landing site / hypothetical habitat: {coordinates(example.start)}. Hypothetical science destination: {coordinates(example.end)}. No astronaut habitat, verified outcrop or approved walking traverse is implied.</p><a href={example.source}>NASA landing coordinates</a> · <a href={example.scienceSource}>NASA scientific importance</a></article>}</>}
    <button className="secondary" onClick={()=>{controller.current?.abort();controller.current=null;setPendingRequest(null);clearGuideContext("marswalk");setResponse(null);setSettings(defaults);setObjective("Photograph and describe Jezero sedimentary layers.");onExample();}}>Load example Marswalk · Jezero</button>
    {onDestination&&<><label>Verified science destination<select aria-label="Verified science destination" value={selectedScience?.name||""} onChange={e=>{const d=scienceDestinations.find(d=>d.name===e.target.value);setScienceName(e.target.value);if(d){setObjective(d.objective);onDestination({lat:d.lat,lon:d.lon});}}}><option value="">Custom map point</option>{scienceDestinations.map(d=><option key={d.name}>{d.name}</option>)}</select></label>
    {selectedScience&&<p>{selectedScience.description} <a href={selectedScience.source}>NASA science context</a> · <a href={`https://planetarynames.wr.usgs.gov/Feature/${selectedScience.feature}`}>USGS coordinates</a></p>}
    <p className="footnote">These are regional feature centres, outside the installed Jezero 20 m crop; expect coarse MOLA or unavailable routes. Habitat stays unchanged. Choose a nearby habitat and validate local access; these are not certified walking destinations.</p></>}
    <form onSubmit={e=>{e.preventDefault();void calculate();}}>
      <label>Science objective<input required maxLength={300} value={objective} onChange={e=>setObjective(e.target.value)} /></label>
      <div className="route-controls">{fields.slice(0,7).map(([name,label,min,max,step])=><label key={name}>{label}<input type="number" required min={min} max={max} step={step} value={settings[name]} onChange={e=>setSettings({...settings,[name]:Number(e.target.value)})}/></label>)}</div>
      <details className="data-details"><summary>Data Details · astronaut rates & assumptions</summary>
        <div className="route-controls">{fields.slice(7).map(([name,label,min,max,step])=><label key={name}>{label}<input type="number" required min={min} max={max} step={step} value={settings[name]} onChange={e=>setSettings({...settings,[name]:Number(e.target.value)})}/></label>)}</div>
        <p>Constant walking speed and phase-specific consumption rates; no physiological slope model. Power includes a user-assumed continuous equipment draw. No airlock, suit-up, rest, thermal, radiation, dust, water or communications model. Add contingency to science duration or reserve. Reserve is held as a fraction of installed oxygen and power capacity; it is not planned consumption. Each journey uses shortest-distance A* with your slope limit.</p>
      </details>
      <button className="send" disabled={!start||!end||pending} type="submit">{pending?"Planning Marswalk…":"Plan Marswalk"}</button>
    </form>
    {error&&<p role="alert" className="error">{error}</p>}
    {mission&&<section aria-label="Marswalk mission summary"><h3>{mission.within_budgets?"Within configured budgets — unvalidated plan":"Mission exceeds configured budgets"}</h3>
      <div className="resolution-notice" role={mission.within_budgets?"status":"alert"}><strong>{mission.within_budgets?"Configured budgets met; environmental safety remains unassessed.":"MODEL-BASED MISSION LIMIT FAILURE — do not treat this plan as feasible."}</strong><ul>{mission.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>
      <Environment point={end} habitat={start}/>
      <p><strong>Science:</strong> {mission.objective}</p>
      <p><strong>Total EVA: {mission.total_minutes.toFixed(1)} min</strong> · Routed round trip {(mission.distance_m/1000).toFixed(3)} km · Budgeted travel including unverified cell connections {(mission.budget_distance_m/1000).toFixed(3)} km</p>
      <div className="route-comparison"><table><thead><tr><th>Phase</th><th>Time (min)</th><th>Oxygen (kg)</th><th>Power (Wh)</th></tr></thead><tbody>{mission.phases.map(p=><tr key={p.name}><th>{p.name}</th><td>{p.minutes.toFixed(1)}</td><td>{p.oxygen_kg.toFixed(3)}</td><td>{p.power_wh.toFixed(1)}</td></tr>)}</tbody></table></div>
      {([['oxygen_kg','Oxygen','kg'],['power_wh','Power','Wh']] as const).map(([key,label,unit])=>{const r=mission.resources[key];return <p key={key}><strong>{label}: {r.used.toFixed(3)} {unit} planned</strong> / {r.capacity} {unit} available · {r.reserve.toFixed(3)} {unit} held in reserve · Required capacity with reserve {r.required_capacity.toFixed(3)} {unit} · {r.sufficient?"Within budget":"INSUFFICIENT"}</p>;})}
      {mission.legs.map(leg=>{const zs=leg.profile.map(p=>p.elevation_m),low=Math.min(...zs),high=Math.max(...zs);return <div key={leg.name}><h4>{leg.name} · {(leg.distance_m/1000).toFixed(3)} km · {leg.travel_minutes.toFixed(1)} min</h4><p className="dataset-badge">{leg.dataset} · {leg.nominal_cell_m.toFixed(0)} m cells</p><p>Ascent {leg.ascent_m.toFixed(1)} m · Descent {leg.descent_m.toFixed(1)} m · Max slope {leg.max_terrain_slope_deg.toFixed(1)}° · Elevation {low.toFixed(0)} to {high.toFixed(0)} m</p><svg className="elevation-profile" viewBox="0 0 800 130" role="img" aria-label={`${leg.name} Marswalk elevation profile`}><text x="0" y="15" fill="#b7c4c8">{high.toFixed(0)} m</text><text x="0" y="110" fill="#b7c4c8">{low.toFixed(0)} m</text><polyline fill="none" stroke="#70f3cf" strokeWidth="2" points={leg.profile.map(p=>`${90+700*p.distance_m/Math.max(1,leg.distance_m)},${110-90*(p.elevation_m-low)/Math.max(1,high-low)}`).join(' ')}/></svg></div>;})}
      <p className="footnote">Both journeys appear on the map; identical outbound/return paths overlap. Profiles use source DEM elevations.</p>
    </section>}
  </section>;
}
