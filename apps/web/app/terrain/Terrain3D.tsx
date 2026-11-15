"use client";

import { useEffect, useRef, useState } from "react";
import { geometry, landmarkHeight, fitCamera, initialCamera, project, wrap, type Camera, type Mesh, type Point } from "./terrain-geometry";

type Props = { endpointLabels?: readonly [string,string]; centre: Point; span: number; start: Point | null; end: Point | null; route: (Point & {elevation_m:number})[]; onSelect: (p:Point)=>void; landmark?: (Point & {name:string}) | null; onLandmarkClick?: ()=>void };
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export default function Terrain3D({centre,span,start,end,route,onSelect,landmark,onLandmarkClick,endpointLabels}: Props) {
  const pin=useRef<HTMLButtonElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const [data,setData]=useState<{key:string;mesh?:Mesh;error?:string}>({key:""});
  const [camera,setCamera]=useState<Camera>(initialCamera);
  const [exaggeration,setExaggeration]=useState(1);
  const [retry,setRetry]=useState(0);
  const [renderError,setRenderError]=useState("");
  const drag=useRef<{x:number;y:number;camera:Camera;pan:boolean;moved:boolean}|null>(null);
  const pick=useRef<(x:number,y:number)=>Point|null>(()=>null);
  const key=`${centre.lat}/${centre.lon}/${span}/${retry}`;
  const mesh=data.key===key?data.mesh:undefined;
  const error=data.key===key?data.error:undefined;
  useEffect(()=>{
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),20000);
    fetch("/api/terrain/mesh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:centre.lat,lon:centre.lon,span}),signal:abort.signal})
      .then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.detail);if(!abort.signal.aborted){setData({key,mesh:body});setCamera(initialCamera);drag.current=null;}})
      .catch(e=>{if(!abort.signal.aborted)setData({key,error:e.message});else if(!disposed)setData({key,error:"Elevation request timed out. Retry or return to Overview."});});
    let disposed=false;
    return ()=>{disposed=true;clearTimeout(timer);abort.abort();};
  },[centre.lat,centre.lon,span,key]);
  useEffect(()=>{
    if(!mesh || !canvas.current)return;
    const el=canvas.current,ctx=el.getContext("2d");
    if(!ctx){queueMicrotask(()=>setRenderError("Canvas rendering is unavailable. Use Overview or Topography."));return;}
    const scene=geometry(mesh,exaggeration);
    function draw(){
      const rect=el.getBoundingClientRect(),w=rect.width,h=rect.height,dpr=Math.min(window.devicePixelRatio||1,2);
      el.width=Math.round(w*dpr);el.height=Math.round(h*dpr);
      ctx!.setTransform(dpr,0,0,dpr,0,0);ctx!.fillStyle="#101c23";ctx!.fillRect(0,0,w,h);
      const fitted=fitCamera(scene,w,h);
      const view={...camera,zoom:camera.zoom*fitted.zoom,panX:camera.panX+fitted.panX*camera.zoom,panY:camera.panY+fitted.panY*camera.zoom};
      if(pin.current){
        const elevation=landmark?landmarkHeight(mesh!,landmark):null;
        const q=landmark && elevation!==null?project(scene.vertex(landmark,elevation),view,w,h):null;
        pin.current.hidden=!q || q.x<0 || q.x>w || q.y<0 || q.y>h;
        if(q){pin.current.style.left=`${q.x}px`;pin.current.style.top=`${el.offsetTop+q.y}px`;}
      }
      const points=scene.vertices.map(v=>v?project(v,view,w,h):null);
      const faces=scene.faces.map(f=>({...f,depth:f.ids.reduce((sum,i)=>sum+points[i]!.depth,0)/3})).sort((a,b)=>a.depth-b.depth);
      for(const face of faces){const [a,b,c]=face.ids.map(i=>points[i]!);ctx!.beginPath();ctx!.moveTo(a.x,a.y);ctx!.lineTo(b.x,b.y);ctx!.lineTo(c.x,c.y);ctx!.closePath();ctx!.fillStyle=face.color;ctx!.fill();}
      function inside(p:Point){const r=(mesh!.lat0-p.lat)/mesh!.step_lat,c=wrap(p.lon-mesh!.lon0)/mesh!.step_lon;return r>=0&&r<=mesh!.heights.length-1&&c>=0&&c<=mesh!.heights[0].length-1;}
      ctx!.strokeStyle="#70f3cf";ctx!.lineWidth=2;ctx!.beginPath();let connected=false;
      for(const p of route){if(!inside(p)){connected=false;continue;}const q=project(scene.vertex(p,p.elevation_m),view,w,h);if(connected)ctx!.lineTo(q.x,q.y);else ctx!.moveTo(q.x,q.y);connected=true;}ctx!.stroke();
      for(const [p,label,color] of [[start,endpointLabels?.[0] || "S","#f3c18d"],[end,endpointLabels?.[1] || "D","#a8d9ff"]] as const){
        if(!p||!inside(p))continue;
        const r=Math.round((mesh!.lat0-p.lat)/mesh!.step_lat),c=Math.round(wrap(p.lon-mesh!.lon0)/mesh!.step_lon),z=mesh!.heights[r]?.[c];
        if(z==null)continue;
        const q=project(scene.vertex(p,z),view,w,h);ctx!.fillStyle=color;ctx!.beginPath();ctx!.arc(q.x,q.y,6,0,Math.PI*2);ctx!.fill();ctx!.font="12px Arial";ctx!.fillText(label,q.x+9,q.y+4);
      }
      ctx!.fillStyle="#b8c7c8";ctx!.font="12px monospace";ctx!.fillText(faces.length?`Elevation colors · ${scene.low.toFixed(0)} to ${scene.high.toFixed(0)} m` : "No connected supported terrain. Pan or zoom out.",12,h-16);
      pick.current=(x,y)=>{
        for(let i=faces.length-1;i>=0;i--){const ids=faces[i].ids,[a,b,c]=ids.map(j=>points[j]!);
          const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-9)continue;
          const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,t=1-u-v;
          if(u<0||v<0||t<0)continue;const verts=ids.map(j=>scene.vertices[j]!);
          return {lat:u*verts[0].lat+v*verts[1].lat+t*verts[2].lat,lon:wrap(u*verts[0].lon+v*verts[1].lon+t*verts[2].lon)};
        }return null;
      };
    }
    const observer=new ResizeObserver(draw);observer.observe(el);draw();return ()=>{observer.disconnect();pick.current=()=>null;};
  },[mesh,camera,exaggeration,start,end,route,landmark,endpointLabels]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    const wheel=(e:WheelEvent)=>{e.preventDefault();setCamera(c=>({...c,zoom:clamp(c.zoom*Math.exp(-e.deltaY*.001),.3,6)}));};
    el.addEventListener("wheel",wheel,{passive:false});return ()=>el.removeEventListener("wheel",wheel);
  },[]);
  return <div className="terrain-3d">
    <div className="scene-tools"><button className="secondary" onClick={()=>setCamera(initialCamera)}>Reset camera</button><label>Relief scale (visualization only) <select value={exaggeration} onChange={e=>setExaggeration(Number(e.target.value))}><option value={1}>1× true scale</option><option value={2}>2× exaggerated</option><option value={5}>5× exaggerated</option></select></label><button className="secondary" onClick={()=>setRetry(v=>v+1)}>Reload terrain</button></div>
    {!mesh&&!error&&<p className="scene-status" role="status">Loading numerical terrain…</p>}
    {(error||renderError)&&<p className="scene-status error" role="alert">{error||renderError}</p>}
    <canvas ref={canvas} tabIndex={0} aria-label="Interactive 3D NASA elevation terrain" aria-describedby="scene-help" style={{visibility:mesh?"visible":"hidden"}}
      onContextMenu={e=>e.preventDefault()}
      onPointerDown={e=>{if(drag.current || (e.button!==0 && e.button!==2))return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,camera,pan:e.shiftKey||e.button===2,moved:false};}}
      onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.hypot(dx,dy)>3)d.moved=true;if(!d.moved)return;const rect=e.currentTarget.getBoundingClientRect();setCamera(d.pan?{...d.camera,panX:d.camera.panX+dx/rect.width,panY:d.camera.panY+dy/rect.height}:{...d.camera,yaw:d.camera.yaw+dx*.008,tilt:clamp(d.camera.tilt+dy*.006,.15,1.45)});}}
      onPointerCancel={()=>{drag.current=null;}}
      onLostPointerCapture={()=>{drag.current=null;}}
      onPointerUp={e=>{if(drag.current&&!drag.current.moved&&mesh){const rect=e.currentTarget.getBoundingClientRect(),p=pick.current(e.clientX-rect.left,e.clientY-rect.top);if(p)onSelect(p);}drag.current=null;}}
      onKeyDown={e=>{if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","=","-","Home","Enter"].includes(e.key))return;e.preventDefault();if(e.key==="Enter"){const rect=e.currentTarget.getBoundingClientRect(),p=pick.current(rect.width/2,rect.height/2);if(p)onSelect(p);return;}if(e.key==="Home"){setCamera(initialCamera);return;}setCamera(c=>({...c,yaw:c.yaw+(!e.shiftKey?(e.key==="ArrowRight"?.1:e.key==="ArrowLeft"?-.1:0):0),tilt:clamp(c.tilt+(!e.shiftKey?(e.key==="ArrowDown"?.1:e.key==="ArrowUp"?-.1:0):0),.15,1.45),panX:c.panX+(e.shiftKey?(e.key==="ArrowRight"?.05:e.key==="ArrowLeft"?-.05:0):0),panY:c.panY+(e.shiftKey?(e.key==="ArrowDown"?.05:e.key==="ArrowUp"?-.05:0):0),zoom:clamp(c.zoom*(e.key==="+"||e.key==="="?1.2:e.key==="-"?1/1.2:1),.3,6)}));}} />
    {mesh && landmark && <button ref={pin} hidden className="landmark-3d-pin" aria-label={`Show ${landmark.name}`} onClick={onLandmarkClick}><svg width="28" height="36" viewBox="-14 -36 28 36" aria-hidden="true"><path d="M0 0 L-10 -17 A12 12 0 1 1 10 -17 Z" fill="#e7baff" stroke="#241a32" strokeWidth="2"/><circle cx="0" cy="-23" r="4" fill="#462266"/></svg><span>{landmark.name}</span></button>}
    <p id="scene-help" className="footnote">Drag / arrows: rotate & tilt · Shift-drag / Shift-arrows: pan camera · Wheel / + −: zoom · Home: reset · Click / Enter: select terrain. Dark holes are unsupported. Geographic pad moves the loaded region.</p>
    {mesh&&<><p className="footnote"><a href={mesh.source}>{mesh.dataset}</a> · Native {mesh.source_cell_m.toFixed(0)} m · Display {mesh.display_cell_m.toFixed(0)} m · Relief {exaggeration}× (visualization only)</p><details className="data-details"><summary>Data Details · 3D terrain</summary><p>Source elevations are unchanged by relief scaling. {mesh.note} Regional patch only (up to 12°); coarse global views are centered here. Route overlay uses route elevations; endpoint markers use nearest display samples.</p></details></>}
  </div>;
}
