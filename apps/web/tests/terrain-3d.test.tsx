import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Terrain3D from "../app/terrain/Terrain3D";

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
test("renders numeric relief and supports keyboard camera controls and picking",async()=>{
  const ctx={setTransform:vi.fn(),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),closePath:vi.fn(),fill:vi.fn(),stroke:vi.fn(),arc:vi.fn(),fillText:vi.fn()};
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"getBoundingClientRect").mockReturnValue({width:800,height:400,left:0,top:0} as DOMRect);
  vi.stubGlobal("ResizeObserver",class {observe(){} disconnect(){}});
  const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({dataset:"Real DEM response fixture",source:"https://pds.nasa.gov/",source_cell_m:20,display_cell_m:20,display_stride:1,radius_m:3396190,lat0:18.65,lon0:226.2,step_lat:.001,step_lon:.001,heights:[[0,0,0],[0,10,0],[0,0,0]],note:"Test data only"})});
  vi.stubGlobal("fetch",fetcher);
  const select=vi.fn(), openLandmark=vi.fn();
  render(<Terrain3D centre={{lat:18.649,lon:-133.799}} span={.02} start={null} end={null} route={[]} onSelect={select} landmark={{name:"Olympus Mons",lat:18.6495,lon:226.2005}} onLandmarkClick={openLandmark}/>);
  await screen.findByText("Real DEM response fixture");
  await waitFor(()=>expect(ctx.lineTo).toHaveBeenCalled());
  const canvas=screen.getByLabelText("Interactive 3D NASA elevation terrain");
  const relief=screen.getByLabelText("Relief scale (visualization only)");
  expect(Array.from(relief.querySelectorAll("option")).map(o=>o.value)).toEqual(["1","2","5"]);
  const marker=screen.getByRole("button",{name:"Show Olympus Mons"});
  expect(marker).toBeVisible();
  fireEvent.click(marker);
  expect(openLandmark).toHaveBeenCalledOnce();
  expect(select).not.toHaveBeenCalled();
  const initial=ctx.moveTo.mock.calls[0];
  for(const event of [{key:"ArrowRight"},{key:"ArrowDown"},{key:"ArrowRight",shiftKey:true},{key:"+"}]) {
    const before=ctx.moveTo.mock.calls.at(-1), pinBefore=marker.style.cssText;
    fireEvent.keyDown(canvas,event);
    expect(ctx.moveTo.mock.calls.at(-1)).not.toEqual(before);
    expect(marker.style.cssText).not.toBe(pinBefore);
  }
  ctx.moveTo.mockClear();fireEvent.keyDown(canvas,{key:"Home"});expect(ctx.moveTo.mock.calls[0]).toEqual(initial);
  fireEvent.keyDown(canvas,{key:"Enter"});expect(select).toHaveBeenCalled();
  expect(select.mock.calls[0][0].lon).toBeGreaterThan(-133.81);
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({lat:18.649,lon:-133.799,span:.02});
});
