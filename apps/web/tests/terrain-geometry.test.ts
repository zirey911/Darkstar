import { expect, test } from "vitest";
import { geometry, landmarkHeight, project, initialCamera, fitCamera, type Mesh } from "../app/terrain/terrain-geometry";
const mesh: Mesh={dataset:"test",source:"",source_cell_m:20,display_cell_m:20,display_stride:1,radius_m:3396190,lat0:18.65,lon0:226.2,step_lat:.001,step_lon:.001,heights:[[0,0,0],[0,40,0],[0,0,0]],note:""};
test("DEM heights generate actual 3D relief with rotation, tilt, zoom and pan",()=>{
  const scene=geometry(mesh,1),peak=scene.vertices[4]!;
  expect(scene.faces).toHaveLength(8);
  expect(peak.z).toBeGreaterThan(scene.vertices[0]!.z);
  const p=project(peak,initialCamera,800,400);
  expect(p.y).not.toBe(project({...peak,z:0},initialCamera,800,400).y);
  expect(project(peak,{...initialCamera,panX:.1},800,400).x-p.x).toBeCloseTo(80);
  const corner=scene.vertices[0]!;
  expect(project(corner,{...initialCamera,yaw:1},800,400).x).not.toBe(project(corner,initialCamera,800,400).x);
  expect(project(peak,{...initialCamera,tilt:.2},800,400).y).not.toBe(p.y);
  expect(Math.abs(project(corner,{...initialCamera,zoom:2},800,400).x-400)).toBeCloseTo(2*Math.abs(project(corner,initialCamera,800,400).x-400));
});
test("missing elevation leaves holes, not invented triangles",()=>{
  const scene=geometry({...mesh,heights:[[0,0,0],[0,null,0],[0,0,0]]},1);
  expect(scene.faces).toHaveLength(2);
  expect(scene.faces.every(f=>!f.ids.includes(4))).toBe(true);
  expect(scene.vertices[4]).toBeNull();
});

test("support masks reject hidden gaps without deleting adjacent supported faces",()=>{
  const scene=geometry({...mesh,faces_supported:[[[false,false],[true,true]],[[true,true],[true,true]]]},1);
  expect(scene.faces).toHaveLength(6);
  expect(scene.vertices.every(v=>v!==null)).toBe(true);
});
test("camera fits actual relief and exaggeration leaves source measurements intact",()=>{
  for(const scale of [1,2,5]) {
    const scene=geometry(mesh,scale),camera=fitCamera(scene,800,400);
    const points=scene.vertices.filter(v=>v!==null).map(v=>project(v,camera,800,400));
    expect(Math.min(...points.map(p=>p.x))).toBeGreaterThanOrEqual(79.9);
    expect(Math.max(...points.map(p=>p.x))).toBeLessThanOrEqual(720.1);
    expect(Math.min(...points.map(p=>p.y))).toBeGreaterThanOrEqual(55.9);
    expect(Math.max(...points.map(p=>p.y))).toBeLessThanOrEqual(344.1);
    expect(scene.vertices[4]!.elevation).toBe(40);
    expect(scene.vertices[4]!.z).toBeCloseTo(geometry(mesh,1).vertices[4]!.z*scale);
  }
});

test("landmark anchors wrap longitude and respect unsupported terrain",()=>{
  const point={lat:18.6495,lon:226.2005};
  expect(landmarkHeight(mesh,point)).toBeCloseTo(0);
  expect(landmarkHeight(mesh,{...point,lon:point.lon-360})).toBeCloseTo(0);
  expect(landmarkHeight(mesh,{lat:18.6485,lon:226.2015})).toBeCloseTo(0);
  expect(landmarkHeight(mesh,{lat:18.649,lon:226.201})).toBeCloseTo(40);
  expect(landmarkHeight(mesh,{lat:19,lon:226.2})).toBeNull();
  expect(landmarkHeight({...mesh,faces_supported:[[[false,false],[true,true]],[[true,true],[true,true]]]},point)).toBeNull();
  expect(landmarkHeight({...mesh,heights:[[null,0,0],[0,40,0],[0,0,0]]},{lat:18.6498,lon:226.2002})).toBeNull();
});
