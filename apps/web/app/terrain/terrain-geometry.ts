export type Point = { lat: number; lon: number };
export type Mesh = {
  dataset: string; source: string; source_cell_m: number; display_stride: number;
  display_cell_m: number; radius_m: number; lat0: number; lon0: number;
  step_lat: number; step_lon: number; heights: (number | null)[][]; faces_supported?: boolean[][][]; note: string;
};
export type Vertex = Point & { x: number; y: number; z: number; elevation: number };
export type Face = { ids: number[]; color: string };
export type Camera = { yaw: number; tilt: number; zoom: number; panX: number; panY: number };
export const initialCamera: Camera = { yaw: -.3, tilt: 1.1, zoom: 1, panX: 0, panY: 0 };
export const wrap = (lon: number) => ((lon + 180) % 360 + 360) % 360 - 180;
export function geometry(mesh: Mesh, exaggeration: number) {
  const rows = mesh.heights.length, cols = mesh.heights[0].length;
  const lat = mesh.lat0 - (rows - 1) * mesh.step_lat / 2;
  const lon = mesh.lon0 + (cols - 1) * mesh.step_lon / 2;
  const metre = mesh.radius_m * Math.PI / 180;
  const xScale = metre * Math.cos(lat * Math.PI / 180);
  const scale = Math.max((cols-1)*mesh.step_lon*xScale, (rows-1)*mesh.step_lat*metre, 1);
  const values = mesh.heights.flat().filter((z): z is number => z !== null);
  const low = Math.min(...values), high = Math.max(...values), base = (low + high) / 2;
  function vertex(p: Point, elevation: number): Vertex {
    return {...p, elevation, x:wrap(p.lon-lon)*xScale/scale, y:(p.lat-lat)*metre/scale, z:(elevation-base)*exaggeration/scale};
  }
  const vertices = mesh.heights.flatMap((row,r) => row.map((z,c) => z === null ? null : vertex({lat:mesh.lat0-r*mesh.step_lat,lon:mesh.lon0+c*mesh.step_lon},z)));
  const faces: Face[] = [];
  for (let r=0;r<rows-1;r++) for(let c=0;c<cols-1;c++) {
    const a=r*cols+c,b=a+1,d=a+cols,e=d+1;
    for(const [index,ids] of [[a,d,b],[b,d,e]].entries()) {
      if (ids.some(i=>vertices[i]===null) || mesh.faces_supported?.[r]?.[c]?.[index] === false) continue;
      const [v0,v1,v2]=ids.map(i=>vertices[i]!);
      const u=[v1.x-v0.x,v1.y-v0.y,v1.z-v0.z],v=[v2.x-v0.x,v2.y-v0.y,v2.z-v0.z];
      const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const light=.25+.75*Math.max(0,(n[0]*.5+n[1]*.5+n[2]*.7071)/Math.hypot(...n));
      const h=((v0.elevation+v1.elevation+v2.elevation)/3-low)/Math.max(1,high-low);
      faces.push({ids,color:`rgb(${Math.round((90+130*h)*light)},${Math.round((115+75*h)*light)},${Math.round((125+30*h)*light)})`});
    }
  }
  return {vertices,faces,vertex,low,high};
}
export function project(v: Vertex, camera: Camera, width: number, height: number) {
  const x=v.x*Math.cos(camera.yaw)-v.y*Math.sin(camera.yaw);
  const y=v.x*Math.sin(camera.yaw)+v.y*Math.cos(camera.yaw);
  const factor=Math.min(width,height)*1.4*camera.zoom;
  return {x:width*(.5+camera.panX)+factor*x,y:height*(.5+camera.panY)-factor*(y*Math.cos(camera.tilt)+v.z*Math.sin(camera.tilt)),depth:-y*Math.sin(camera.tilt)+v.z*Math.cos(camera.tilt)};
}

// Fit to the actual connected terrain at the default oblique orientation.
// This remains a stable baseline during camera gestures; rotation does not auto-zoom.
export function fitCamera(scene: ReturnType<typeof geometry>, width: number, height: number): Camera {
  const used = new Set(scene.faces.flatMap(f=>f.ids));
  const points = [...used].map(i=>project(scene.vertices[i]!,initialCamera,width,height));
  if(!points.length)return initialCamera;
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const zoom=Math.min(width*.8/Math.max(1,maxX-minX),height*.72/Math.max(1,maxY-minY),4);
  return {...initialCamera,zoom,panX:(width/2-(minX+maxX)/2)*zoom/width,panY:(height/2-(minY+maxY)/2)*zoom/height};
}

// Locate a pin on the rendered surface, never across an unsupported triangle.
// Interpolation positions the visual overlay only; it is not an elevation measurement.
export function landmarkHeight(mesh: Mesh, point: Point): number | null {
  const row=(mesh.lat0-point.lat)/mesh.step_lat,col=wrap(point.lon-mesh.lon0)/mesh.step_lon;
  const rows=mesh.heights.length,cols=mesh.heights[0].length;
  if(row<0||col<0||row>rows-1||col>cols-1)return null;
  const r=Math.min(Math.floor(row),rows-2),c=Math.min(Math.floor(col),cols-2),y=row-r,x=col-c;
  const triangle=x+y<=1?0:1;
  if(mesh.faces_supported?.[r]?.[c]?.[triangle]===false)return null;
  const a=mesh.heights[r][c],b=mesh.heights[r][c+1],d=mesh.heights[r+1][c],e=mesh.heights[r+1][c+1];
  if(triangle===0)return a===null||b===null||d===null?null:a*(1-x-y)+b*x+d*y;
  return b===null||d===null||e===null?null:b*(1-y)+d*(1-x)+e*(x+y-1);
}
