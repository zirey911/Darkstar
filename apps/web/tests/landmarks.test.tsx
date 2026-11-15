import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Terrain from "../app/terrain/page";
import { landmarks } from "../app/terrain/landmarks";

vi.mock("../app/terrain/Terrain3D",()=>({default:({centre,span}:{centre:{lat:number;lon:number};span:number})=><div data-testid="terrain-3d" data-lat={centre.lat} data-lon={centre.lon} data-span={span}/> }));
afterEach(()=>vi.unstubAllGlobals());
test.each(["Overview","Topography","3D Terrain"])("landmarks preserve endpoints and mode in %s",async mode=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({provenance:{dataset:"MOLA fixture",elevation_datum:"areoid"},nominal_cell_m:3704})}));
  render(<Terrain/>);
  await screen.findByText(/MOLA fixture/);
  fireEvent.click(screen.getByRole("button",{name:mode}));
  const input=screen.getByLabelText("Find a landmark");
  expect(document.querySelectorAll("#mars-landmarks option")).toHaveLength(7);
  for(const location of landmarks){
    fireEvent.change(input,{target:{value:location.name}});
    expect(screen.getByRole("button",{name:mode})).toHaveAttribute("aria-pressed","true");
    const signed=(location.lon+180)%360-180;
    if(mode==="3D Terrain"){
      const scene=screen.getByTestId("terrain-3d");
      expect(Number(scene.dataset.lat)).toBeCloseTo(location.lat);
      expect(Number(scene.dataset.lon)).toBeCloseTo(signed);
      expect(Number(scene.dataset.span)).toBeCloseTo(Math.min(12,360/2**location.zoom));
    }else{
      const [west,north,width,height]=screen.getByRole("img",{name:/Global Mars map/}).getAttribute("viewBox")!.split(" ").map(Number);
      expect(west+width/2).toBeCloseTo(signed);
      expect(-north-height/2).toBeCloseTo(location.lat);
      expect(width).toBeCloseTo(360/2**location.zoom);
    }
    expect(screen.getByRole("status")).toHaveTextContent(`${location.lon.toFixed(2)}° E`);
    expect(screen.getByRole("link",{name:location.name})).toHaveAttribute("href",`https://planetarynames.wr.usgs.gov/Feature/${location.feature}`);
    expect(screen.getByLabelText("start latitude")).toHaveValue(60);
    expect(screen.getByLabelText("start longitude")).toHaveValue(30);
    expect(screen.getByLabelText("end latitude")).toHaveValue(61);
    expect(screen.getByLabelText("end longitude")).toHaveValue(32);
  }
  fireEvent.change(input,{target:{value:"unknown place"}});
  expect(screen.getByRole("button",{name:"Go"})).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Utopia Planitia");
  fireEvent.change(input,{target:{value:"  olympus mons  "}});
  expect(screen.getByRole("status")).toHaveTextContent("Olympus Mons");
});

test("landmark pin stays geographically anchored across pan, zoom and layers; popup leaves endpoints alone",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({provenance:{dataset:"MOLA fixture",elevation_datum:"areoid"},nominal_cell_m:3704})}));
  render(<Terrain/>);
  await screen.findByText(/MOLA fixture/);
  fireEvent.change(screen.getByLabelText("Find a landmark"),{target:{value:"Olympus Mons"}});
  const anchor=()=>screen.getByRole("button",{name:"Show Olympus Mons"});
  const position=()=>anchor().getAttribute("transform")!.split(" scale")[0];
  expect(position()).toContain("translate(-133.8 -18.65)");
  const original=position();
  fireEvent.click(screen.getByRole("button",{name:"Zoom in"}));
  fireEvent.keyDown(screen.getByRole("img",{name:/Global Mars map/}),{key:"ArrowRight"});
  expect(position()).toBe(original);
  fireEvent.click(screen.getByRole("button",{name:"Set start"}));
  fireEvent.click(anchor());
  expect(screen.getByRole("dialog",{name:"Landmark details"})).toHaveTextContent("18.65° N, 226.20° E");
  expect(screen.getByLabelText("start latitude")).toHaveValue(60);
  expect(screen.getByLabelText("start longitude")).toHaveValue(30);
  fireEvent.click(screen.getByRole("button",{name:"Topography"}));
  expect(position()).toBe(original);
  fireEvent.click(screen.getByRole("button",{name:"Close landmark details"}));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.keyDown(anchor(),{key:"Enter"});
  expect(screen.getByRole("dialog")).toHaveTextContent("Olympus Mons");
  expect(screen.getByLabelText("start latitude")).toHaveValue(60);
  fireEvent.click(screen.getByRole("button",{name:"3D Terrain"}));
  fireEvent.click(screen.getByRole("button",{name:"Overview"}));
  expect(position()).toBe(original);
});
