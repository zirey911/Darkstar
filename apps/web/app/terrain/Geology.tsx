"use client";
import { useEffect, useState } from "react";
import type { Point } from "./terrain-geometry";
type Data={units:{unit:string|null;description:string|null}[];dataset:string;scale:string;source:string;note:string};
export default function Geology({point}:{point:Point|null}){
 const [state,setState]=useState<{key:string;data?:Data;error?:string}>({key:""});
 const key=JSON.stringify(point);
 useEffect(()=>{
  if(!point)return;
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),15000);
  fetch("/api/terrain/geology-inspect",{method:"POST",headers:{"Content-Type":"application/json"},body:key,signal:abort.signal})
   .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.detail);if(!abort.signal.aborted)setState({key,data:d});})
   .catch(e=>{if(!disposed)setState({key,error:abort.signal.aborted?"Geology request timed out.":e.message});});
  let disposed=false;return()=>{disposed=true;abort.abort();clearTimeout(timer);};
 },[key,point]);
 const current=state.key===key?state:undefined;
 return <section className="route-result" aria-label="Geology inspection"><h3>Geology inspection</h3>
  <p>USGS SIM 3292 (2014) · Global Mars · 1:20,000,000 mapping scale</p>
  {!point?<p>Click the map to inspect a mapped unit.</p>:<><p>{point.lat.toFixed(4)}° N, {((point.lon%360+360)%360).toFixed(4)}° E</p>
   {!current&&<p role="status">Reading geological units…</p>}
   {current?.error&&<p role="alert">{current.error} No classification is inferred.</p>}
   {current?.data&&<>{current.data.units.length?current.data.units.map((u,i)=><p key={i}><strong>{u.unit||"Unit code unavailable"}</strong> · {u.description||"Description unavailable"}</p>):<p>No mapped unit returned at this coordinate; geological information unavailable.</p>}
    <p className="footnote">{current.data.note}</p></>}
  </>}
  <details className="data-details"><summary>Data Details · geology</summary><p><a href="https://pubs.usgs.gov/sim/3292/">Tanaka et al., USGS SIM 3292</a>, served by Esri. Mars 2000 spherical geographic CRS (104971), east-positive longitude. Colors are categorical geological units, not elevation or natural color. The legend and full unit explanations are in the linked map publication.</p><p>Tile display is capped at native level 6 (≈0.022°/pixel, ≈1.3 km/pixel at the equator) and enlarged at closer zooms; this is display sampling, not geological accuracy. Missing fine tiles retain coarser geology; missing base tiles stay blank. Unit boundaries are regional interpretations. Neither these classifications nor science feature centres establish foot-scale hazards, rock composition at a precise point, or safe access. Elevation and routing still use MOLA/CTX independently.</p></details>
 </section>;
}
