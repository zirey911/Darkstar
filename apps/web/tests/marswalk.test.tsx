import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Terrain from "../app/terrain/page";
vi.mock("../app/terrain/Terrain3D",()=>({default:({route}:{route:unknown[]})=><div data-testid="mission-3d-route">{route.length} route vertices</div>}));
afterEach(()=>vi.unstubAllGlobals());
test("plans a Jezero Marswalk, shows both legs and clears stale results after edits",async()=>{
 const resource={used:.2,capacity:1,reserve:.25,required_capacity:.267,remaining:.8,sufficient:true};
 const profile=[{lat:18.4447,lon:77.4508,elevation_m:-2500,distance_m:0,slope_deg:2},{lat:18.45,lon:77.46,elevation_m:-2490,distance_m:700,slope_deg:2}];
 const leg={profile,distance_m:700,travel_minutes:21,ascent_m:10,descent_m:0,dataset:"Jezero CTX",nominal_cell_m:20,max_terrain_slope_deg:2};
 const fetcher=vi.fn().mockImplementation(async(url)=>({ok:true,json:async()=>url==="/api/terrain/metadata"?{provenance:{dataset:"MOLA fixture",elevation_datum:"areoid"},nominal_cell_m:3704}:{objective:"Photograph and describe Jezero sedimentary layers.",legs:[{...leg,name:"Outbound"},{...leg,name:"Return",profile:[{...profile[1],distance_m:0},{...profile[0],distance_m:700}]}],phases:[{name:"Outbound",minutes:21,oxygen_kg:.05,power_wh:80},{name:"Science",minutes:30,oxygen_kg:.05,power_wh:100},{name:"Return",minutes:21,oxygen_kg:.05,power_wh:80}],total_minutes:72,distance_m:1400,budget_distance_m:1420,resources:{oxygen_kg:resource,power_wh:{...resource,capacity:1000,used:260}},within_budgets:true,warnings:["Unvalidated example"]}}));
 vi.stubGlobal("fetch",fetcher);render(<Terrain/>);
 await screen.findByText(/MOLA fixture/);
 expect(screen.getByRole("button",{name:"Marswalk"})).toBeVisible();
 expect(screen.getByRole("button",{name:"Rover"})).toHaveAttribute("aria-pressed","true");
 fireEvent.click(screen.getByRole("button",{name:"Marswalk"}));
 fireEvent.click(screen.getByRole("button",{name:"Load example Marswalk · Jezero"}));
 expect(screen.getByRole("button",{name:"Set habitat"})).toBeVisible();
 expect(screen.getByRole("button",{name:"Set science stop"})).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Plan Marswalk"}));
 expect(await screen.findByRole("region",{name:"Marswalk mission summary"})).toHaveTextContent("Total EVA: 72.0 min");
 expect(screen.getByRole("img",{name:"Outbound Marswalk elevation profile"})).toBeVisible();
 expect(screen.getByRole("img",{name:"Return Marswalk elevation profile"})).toBeVisible();
 expect(screen.getByRole("region",{name:"Environmental context"})).toBeVisible();
 expect(JSON.parse(fetcher.mock.calls.find(c=>c[0]==="/api/terrain/environment")![1].body).locations.map((p:{label:string})=>p.label)).toEqual(["Habitat","Science destination"]);
 const map=screen.getByRole("img",{name:/Global Mars map/});expect(map.querySelector("polyline")).toBeTruthy();
 expect(map).toHaveTextContent("SCI");
 for(const mode of ["Topography","Geology","3D Terrain","Overview"]){
  fireEvent.click(screen.getByRole("button",{name:mode}));
  expect(screen.getByRole("region",{name:"Marswalk mission summary"})).toHaveTextContent("Total EVA: 72.0 min");
  if(mode==="3D Terrain")expect(screen.getByTestId("mission-3d-route")).toHaveTextContent("4 route vertices");
  else expect(screen.getByRole("img",{name:/Global Mars map/}).querySelector("polyline")).toBeTruthy();
 }

 const body=JSON.parse(fetcher.mock.calls.find(c=>c[0]==="/api/terrain/marswalk")![1].body);
 expect(body.start).toEqual({lat:18.4447,lon:77.4508});expect(body.end).toEqual({lat:18.45,lon:77.46});
 fireEvent.change(screen.getByLabelText("Walking speed (km/h)"),{target:{value:"1"}});
 await waitFor(()=>expect(screen.queryByRole("region",{name:"Marswalk mission summary"})).toBeNull());
 expect(screen.getByRole("img",{name:/Global Mars map/}).querySelector("polyline")).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Rover"}));
 expect(screen.getByRole("button",{name:"Calculate route"})).toBeVisible();
 expect(screen.queryByRole("button",{name:"Plan Marswalk"})).toBeNull();
 fireEvent.click(screen.getByRole("button",{name:"Marswalk"}));
 expect(screen.getByLabelText("Walking speed (km/h)")).toHaveValue(1);
 for(const label of ["Science duration (minutes)","Astronaut maximum slope (degrees)","Maximum EVA duration (minutes)","Available oxygen (kg)","Available power (Wh)","Emergency reserve (fraction of each capacity)"])
  expect(screen.getByLabelText(label)).toBeVisible();
});
