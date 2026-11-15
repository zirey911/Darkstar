"use client";
import { useEffect, useState } from "react";
import { saveGuideContext, clearGuideContext } from "../guide-context";
import type { Point } from "./terrain-geometry";
type Reference={id:string;title:string;kind:string;site:string;date:string;coverage:string;resolution:string;uncertainty:string;source:string;archive:string;label_source?:string;values:{label:string;value:number|null;unit:string}[]};
type Data={locations:{label:string;coordinate:Point;current_conditions:string;reference_distances_km:Record<string,number>}[];references:Reference[];retrieved_on:string;modeled_estimates:string;warnings:{category:string;text:string;source:string}[];mission_effect:string};
export default function Environment({point,habitat}:{point:Point|null;habitat?:Point|null}){
 const locations=habitat?[{label:"Habitat",coordinate:habitat},...(point?[{label:"Science destination",coordinate:point}]:[])]:point?[{label:"Selected location",coordinate:point}]:[];
 const key=locations.length?JSON.stringify({locations}):"";
 const [state,setState]=useState<{key:string;data?:Data;error?:string}>({key:""});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!key)return;
  clearGuideContext("environment");
  const abort=new AbortController();let disposed=false;const timer=setTimeout(()=>abort.abort(),15000);
  fetch("/api/terrain/environment",{method:"POST",headers:{"Content-Type":"application/json"},body:key,signal:abort.signal})
   .then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.detail);if(!Array.isArray(data.references)||!Array.isArray(data.locations)||!Array.isArray(data.warnings))throw new Error("Environmental reference response unavailable.");if(!disposed){setState({key,data});saveGuideContext("environment",data.chat_context);}})
   .catch(e=>{if(!disposed)setState({key,error:abort.signal.aborted?"Environmental request timed out.":e.message});});
  return()=>{disposed=true;abort.abort();clearTimeout(timer);};
 },[key,retry]);
 const current=state.key===key?state:undefined;
 if(!key)return null;
 return <section className="environment-panel" aria-label="Environmental context">
  <h3>Environmental context</h3>
  <p className="resolution-notice">Historical references only — not live weather, a forecast or an EVA safety clearance. Current local conditions are unavailable.</p>
  {!current&&<p role="status">Loading environmental references…</p>}
  {current?.error&&<p role="alert">{current.error} Temperature, pressure, dust and radiation remain unassessed. <button className="secondary" onClick={()=>{setState({key:""});setRetry(n=>n+1);}}>Retry environmental data</button></p>}
  {current?.data&&<>
   {current.data.locations.map(l=><p key={l.label}><strong>{l.label}:</strong> {Math.abs(l.coordinate.lat).toFixed(4)}° {l.coordinate.lat<0?"S":"N"}, {((l.coordinate.lon%360+360)%360).toFixed(4)}° E · {l.current_conditions}</p>)}
   <ul>{current.data.warnings.map(w=><li key={w.category}><strong>{w.category}:</strong> {w.text} <a href={w.source}>NASA/PDS</a></li>)}</ul>
   <details className="data-details"><summary>Data Details · historical environmental measurements</summary>
    <p>Pinned extract retrieved {current.data.retrieved_on}. No automatic refresh. {current.data.modeled_estimates} Distances below are to named crater centres, not to sensor footprints. No proximity implies measurement coverage.</p>
    {current.data.references.map(r=><article key={r.id}><h4>{r.title}</h4><p><strong>{r.kind}</strong> · {r.date} · {r.site}</p>
     <dl>{r.values.map(v=><div key={v.label}><dt>{v.label}</dt><dd>{v.value===null?"Unavailable in this source":`${v.value} ${v.unit}`}</dd></div>)}</dl>
     <p>{r.coverage} {r.resolution}</p><p>Uncertainty: {r.uncertainty}</p>
     <p>{current.data!.locations.map(l=>`${l.label}: ${l.reference_distances_km[r.id].toLocaleString()} km from reference centre`).join(" · ")}</p>
     <p><a href={r.source}>Original source</a> · <a href={r.archive}>Archive / scientific documentation</a>{r.label_source&&<> · <a href={r.label_source}>PDS label</a></>}</p>
    </article>)}
   </details>
   <p className="footnote">{current.data.mission_effect}</p>
  </>}
 </section>;
}
