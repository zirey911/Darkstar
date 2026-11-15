"use client";
import {useEffect,useState} from "react";
import type {Point} from "./terrain-geometry";
export type MissionMarker = Point & {id:string;level:"red"|"yellow"|"green";title:string;evidence:string;source:string};
type Inspection={cell_centre:Point;slope_deg:number|null;routing_supported:boolean;nominal_cell_m:number;dataset:string;dataset_id:string;fallback_reason?:string};
const molaSource="https://pds-geosciences.wustl.edu/missions/mgs/megdr.html";
const ctxSource="https://pds-imaging.jpl.nasa.gov/volumes/mro.html";
export default function MissionAwareness({active,start,end,limit,route,onMarkers}:{active:boolean;start:Point|null;end:Point|null;limit:number;route:{lat:number;lon:number;slope_deg:number;dataset:string;nominal_cell_m:number;dataset_id:string}[];onMarkers:(markers:MissionMarker[])=>void}){
 const key=JSON.stringify({start,end,limit,active});
 const [state,setState]=useState<{key:string;markers:MissionMarker[]}|null>(null);
 useEffect(()=>{
  if(!active)return;
  const {start,end,limit}=JSON.parse(key);const abort=new AbortController();let disposed=false;
  const timer=setTimeout(()=>abort.abort(),15000);
  Promise.all(([['Habitat',start],['Science destination',end]] as const).filter(([,p])=>p).map(async([name,p])=>{
   try{
    const r=await fetch('/api/terrain/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p),signal:abort.signal});
    if(!r.ok)throw new Error('Unavailable');const d:Inspection=await r.json();
    if(!d.cell_centre||!Number.isFinite(d.nominal_cell_m)||typeof d.routing_supported!=="boolean")throw new Error('Invalid inspection');
    const exceeded=typeof d.slope_deg==='number'&&d.slope_deg>limit;
    return { ...p,id:name,level:exceeded?'red':'yellow',title:exceeded?`${name}: slope exceeds limit`:`${name}: local conditions unresolved`,
     evidence:`${d.dataset}, ${d.nominal_cell_m.toFixed(0)} m cells. DEM slope ${d.slope_deg===null?'unavailable':d.slope_deg.toFixed(2)+'°'}; configured limit ${limit}°. ${!d.routing_supported?'Unsupported terrain/stencil; routing blocked. ':''}${d.fallback_reason||''} Sub-cell obstacles and current temperature, pressure, dust and radiation are unassessed. Sample centre ${d.cell_centre.lat.toFixed(5)}° N, ${((d.cell_centre.lon+360)%360).toFixed(5)}° E. A DEM slope is a terrain estimate, not a ground survey.`,source:d.dataset_id==='mola16'?molaSource:ctxSource} as MissionMarker;
   }catch{return {...p,id:name,level:'yellow',title:`${name}: terrain assessment unavailable`,evidence:'No verified slope or terrain support is available from inspection. No local environmental safety assessment. Do not infer traversability.',source:molaSource} as MissionMarker;}
  })).then(markers=>{if(!disposed)setState({key,markers});});
  return()=>{disposed=true;abort.abort();clearTimeout(timer);};
 },[key,active]);
 const current=state?.key===key?state.markers:null;
 const routeKey=JSON.stringify(route);
 useEffect(()=>{
  if(!active){onMarkers([]);return;}
  const points:MissionMarker[]=[...(current||[])];
  if(end)points.push({...end,id:'objective',level:'green',title:'Planned science objective',evidence:'User-selected or hypothetical example destination. Scientific intent is not proof of a local exposure or safe access. See the mission objective and linked NASA sources in the planner.',source:'https://science.nasa.gov/mars/'});
  const samples=JSON.parse(routeKey) as typeof route;
  if(samples.length){const p=samples.reduce((a,b)=>a.slope_deg>b.slope_deg?a:b);points.push({...p,id:'route-slope',level:p.slope_deg>limit?'red':'yellow',title:'Route: steepest sampled cell',evidence:`${p.dataset}; ${p.nominal_cell_m.toFixed(0)} m cells. Maximum sampled terrain slope ${p.slope_deg.toFixed(2)}°; limit ${limit}°. A* checks the route's cells and edges, but sub-cell hazards and current environmental conditions remain unknown along the entire route.`,source:p.dataset_id==='mola16'?molaSource:ctxSource});}
  onMarkers(points);
 },[active,current,end,limit,onMarkers,routeKey]);
 if(!active)return null;
 return <section aria-label="Pre-mission terrain assessment" className="resolution-notice"><strong>Pre-mission checks · no EVA safety clearance</strong>
 <p>Red: DEM slope exceeds your limit. Yellow: uncertainty or insufficient data. Green: science objective, not safe terrain.</p>
 {!current?<p role="status">Checking endpoint terrain…</p>:<ul>{current.map(p=><li key={p.id}><strong>{p.level==='red'?'LIMIT EXCEEDED':'UNKNOWN'} · {p.title}</strong><details><summary>Supporting evidence</summary><p>{p.evidence} <a href={p.source}>NASA/PDS terrain source</a></p></details></li>)}</ul>}
 <p>Historical environmental references do not establish present conditions here. <a href="https://science.nasa.gov/mars/facts/">NASA context</a>. Route feasibility and oxygen, power, reserve and duration checks follow when you select Plan Marswalk.</p>
 </section>;
}
