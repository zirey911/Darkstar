import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Environment from "../app/terrain/Environment";
afterEach(()=>vi.unstubAllGlobals());
test("shows historical provenance and missing values without claiming local conditions",async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({locations:[{label:"Habitat",coordinate:{lat:18.4,lon:77.4},current_conditions:"Unavailable",reference_distances_km:{meda:12}}],references:[{id:"meda",title:"Perseverance / Jezero",kind:"Historical summary",site:"Jezero",date:"2024-04-27",coverage:"Rover only",resolution:"Daily summary",uncertainty:"Not supplied",source:"https://mars.nasa.gov/",archive:"https://pds.nasa.gov/",values:[{label:"Ground temperature",value:null,unit:"°C"},{label:"Pressure",value:778.9,unit:"Pa"}]}],retrieved_on:"2026-11-15",modeled_estimates:"No model",warnings:[{category:"Radiation",text:"Local dose unknown",source:"https://science.nasa.gov/"}],mission_effect:"No safety approval"})});
 vi.stubGlobal("fetch",fetcher);
 render(<Environment point={{lat:18.45,lon:77.46}} habitat={{lat:18.4,lon:77.4}}/>);
 expect(await screen.findByText(/Local dose unknown/)).toBeVisible();
 expect(screen.getByText(/not live weather/)).toBeVisible();
 const historical=screen.getByText(/2024-04-27/);expect(historical).not.toBeVisible();
 fireEvent.click(screen.getByText("Data Details · historical environmental measurements"));
 expect(historical).toBeVisible();expect(screen.getByText("Unavailable in this source")).toBeVisible();
 expect(screen.getByText("778.9 Pa")).toBeVisible();
 expect(JSON.parse(fetcher.mock.calls[0][1].body).locations).toHaveLength(2);
});
test("failed environmental requests remain unassessed",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:"Unavailable"})}));
 render(<Environment point={{lat:0,lon:0}}/>);
 expect(await screen.findByRole("alert")).toHaveTextContent("remain unassessed");
});
