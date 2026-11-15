import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Terrain from "../app/terrain/page";

afterEach(() => vi.unstubAllGlobals());
const metadata = { provenance: { dataset: "MOLA test metadata", elevation_datum: "areoid" }, nominal_cell_m: 3704 };
test("selects coordinates, renders a route/profile and clears stale results on edits", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:"Environment fixture unavailable"})}).mockResolvedValueOnce({ ok: true, json: async () => metadata })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      profile: [{ lat: 60, lon: 179, elevation_m: -2000, distance_m: 0 }, { lat: 61, lon: -179, elevation_m: -1900, distance_m: 95000 }],
      distance_m: 95000, ascent_m: 100, descent_m: 0, max_terrain_slope_deg: 3,
      nominal_cell_m: 3704, snapping_m: { start: 100, end: 200 }, coarse_to_fine: false,
      energy_wh: 123.45, energy_capacity_fraction: .12345, within_energy_capacity: true, braking_loss_j: 4000, optimization: "distance",
      comparisons: [{ optimization: "distance", distance_m: 95000, ascent_m: 100, descent_m: 0, energy_wh: 123.45, max_terrain_slope_deg: 3, effective_max_slope_deg: 15, within_energy_capacity: true, dataset: "MOLA", nominal_cell_m: 3704 }],
      unsupported_fraction: .1, limitations: ["Fixture only"], energy_proxy_m: 4850,
    }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  fireEvent.change(screen.getByLabelText("start longitude"), { target: { value: "179" } });
  fireEvent.change(screen.getByLabelText("end longitude"), { target: { value: "181" } });
  fireEvent.click(screen.getByRole("button", { name: "Calculate route" }));
  expect(await screen.findByRole("heading", { name: "95.00 km regional route" })).toBeVisible();
  expect(screen.getByRole("img", { name: /Route elevation profile/ })).toBeVisible();
  const routeLine = screen.getByRole("img", { name: /Global Mars map/ }).querySelector("polyline")!;
  const longitudes = routeLine.getAttribute("points")!.split(" ").map(p => Number(p.split(",")[0]));
  expect(Math.abs(longitudes[1] - longitudes[0])).toBe(2);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({max_slope_deg: 15, compare: true, optimization: "distance", rover: {mass_kg: 200, drivetrain_efficiency: .7}});
  expect(screen.getByText("Estimated traction energy: 123.45 Wh")).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("123.45 Wh");
  fireEvent.change(screen.getByLabelText("start latitude"), { target: { value: "62" } });
  expect(screen.queryByRole("heading", { name: "95.00 km regional route" })).not.toBeInTheDocument();
});
test("shows missing data errors without displaying a route", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ detail: "MOLA terrain unavailable" }) }));
  render(<Terrain />);
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("MOLA terrain unavailable"));
  expect(screen.getByRole("button", { name: "Calculate route" })).toBeDisabled();
  expect(screen.queryByLabelText("Route result")).not.toBeInTheDocument();
});

test("switches elevation layer, inspects numerical terrain and uses it as destination", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:"Environment fixture unavailable"})}).mockResolvedValueOnce({ ok: true, json: async () => metadata })
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      coordinate: { lat: 60, lon: 30 }, cell_centre: { lat: 59.96875, lon: 30.03125 },
      elevation_m: -3500, observations: 12, slope_deg: 1.25, support: "observed",
      routing_supported: true, nominal_cell_m: 3704, datum: "MOLA areoid",
    }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  fireEvent.click(screen.getByRole("button", { name: "Topography" }));
  expect(screen.getByRole("button", { name: "Topography" })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector("image")?.getAttribute("href")).toContain("/topography/");
  const map = screen.getByRole("img", { name: /Global Mars map/ });
  fireEvent.click(screen.getByRole("button", { name: /Zoom in/ }));
  expect(map.getAttribute("viewBox")).toBe("-90 -45 180 90");
  fireEvent.keyDown(map, { key: "ArrowRight" });
  expect(map.getAttribute("viewBox")).toBe("-45 -45 180 90");
  fireEvent.click(screen.getByRole("button", { name: "Inspect start" }));
  expect(await screen.findByText("observed")).toBeVisible();
  expect(screen.getByText("1.25°")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use as destination" }));
  expect(screen.getByLabelText("end latitude")).toHaveValue(60);
  expect(screen.getByLabelText("end longitude")).toHaveValue(30);
});


test("wraps the map and tile columns across the seam, clamps poles, and resets endpoints", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => metadata });
  vi.stubGlobal("fetch", fetcher);
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  const map = screen.getByRole("img", { name: /Global Mars map/ });
  fireEvent.click(screen.getByRole("button", { name: /Zoom in/ }));
  fireEvent.click(screen.getByRole("button", { name: "East" }));
  fireEvent.click(screen.getByRole("button", { name: "East" }));
  expect(map.getAttribute("viewBox")).toBe("-270 -45 180 90");
  const tileUrls = Array.from(map.querySelectorAll("image")).map(image => image.getAttribute("href"));
  expect(tileUrls.some(url => url?.includes("/2/1/7?"))).toBe(true);
  expect(tileUrls.every(url => !url?.includes("/-"))).toBe(true);
  for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "North" }));
  expect(map.getAttribute("viewBox")).toBe("-270 -90 180 90");
  fireEvent.click(screen.getByRole("button", { name: "Reset endpoints" }));
  expect(screen.getByLabelText("start latitude")).toHaveValue(null);
  expect(screen.getByLabelText("end latitude")).toHaveValue(null);
  expect(screen.getByRole("button", { name: "Calculate route" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Load example" }));
  expect(screen.getByRole("button", { name: "Calculate route" })).toBeEnabled();
});

test("wheel zoom is fractional and keeps the point under the cursor fixed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => metadata }));
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  const map = screen.getByRole("img", { name: /Global Mars map/ });
  vi.spyOn(map, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 800, height: 400 } as DOMRect);
  fireEvent.wheel(map, { deltaY: -50, clientX: 600, clientY: 200 });
  const [west, northY, width, height] = map.getAttribute("viewBox")!.split(" ").map(Number);
  expect(width).toBeGreaterThan(180);
  expect(width).toBeLessThan(360);
  expect(west + width * .75).toBeCloseTo(90);
  expect(northY + height * .5).toBeCloseTo(0);
});

test("shows installed CTX coverage and inspects stereo elevations without invented counts", async () => {
  const fetcher = vi.fn().mockResolvedValue({ok:false,json:async()=>({detail:"Environment fixture unavailable"})}).mockResolvedValueOnce({ ok: true, json: async () => ({ ...metadata,
    regions: [{ id: "jezero-ctx20", dataset: "Jezero CTX", bounds: [77.38, 18.36, 77.62, 18.54], source_resolution_m: 20 }],
  }) }).mockResolvedValueOnce({ ok: true, json: async () => ({
    coordinate: { lat: 18.4447, lon: 77.4508 }, cell_centre: { lat: 18.4448, lon: 77.4508 },
    elevation_m: -2567, observations: null, slope_deg: 2.7, support: "stereo-derived",
    routing_supported: true, nominal_cell_m: 20, datum: "Localized to MOLA", dataset: "Jezero CTX",
  }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Terrain />);
  fireEvent.click(await screen.findByRole("button", { name: "Explore Jezero · 20 m" }));
  expect(document.querySelector('image[href*="/region-map"]')).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load Jezero route" }));
  expect(screen.getByLabelText("start latitude")).toHaveValue(18.4447);
  fireEvent.click(screen.getByRole("button", { name: "Inspect start" }));
  expect(await screen.findByText("Jezero CTX · 20 m cells")).toBeVisible();
  const observation=screen.getByText("Not supplied");
  expect(observation).not.toBeVisible();
  fireEvent.click(screen.getByText("Data Details · inspected terrain"));
  expect(observation).toBeVisible();
});

test("Olympus Mons click, east-positive inputs and signed API coordinates agree", async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, options) => ({ ok: true, json: async () => options?.body ? {
    coordinate: JSON.parse(options.body), cell_centre: {lat:18.65625,lon:-133.78125},
    elevation_m: 21000, observations: 1, slope_deg: 3, support: "observed",
    routing_supported: true, nominal_cell_m: 3704, datum: "MOLA",
  } : metadata }));
  vi.stubGlobal("fetch", fetcher);
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  const map = screen.getByRole("img", {name: /Global Mars map/});
  vi.spyOn(map, "getBoundingClientRect").mockReturnValue({left:0,top:0,width:720,height:360} as DOMRect);
  fireEvent.click(screen.getByRole("button", {name: "Select start on map"}));
  // Global view: -180..180 longitude; Olympus 226.20 E is -133.80 internally.
  fireEvent.click(map, {clientX:92.4,clientY:142.7});
  expect(await screen.findByRole("heading", {name:"18.6500° N, 226.2000° E"})).toBeVisible();
  expect(screen.getByLabelText("start longitude")).toHaveValue(226.2);
  const selected = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(selected.lat).toBeCloseTo(18.65);
  expect(selected.lon).toBeCloseTo(-133.8);
  const cell=screen.getByText(/Cell centre 18.6563° N, 226.2188° E/);
  expect(cell).not.toBeVisible();
  fireEvent.click(screen.getByText("Data Details · inspected terrain"));
  expect(cell).toBeVisible();
  const marker = Array.from(map.querySelectorAll("circle")).find(c => Math.abs(Number(c.getAttribute("cx")) + 133.8) < 1e-6);
  expect(marker).toBeTruthy();
  for (const [entered, shown, internal] of [[359.9,359.9,-.1],[360,0,0],[.1,.1,.1]]) {
    fireEvent.change(screen.getByLabelText("start longitude"), {target:{value:String(entered)}});
    expect(screen.getByLabelText("start longitude")).toHaveValue(shown);
    fireEvent.click(screen.getByRole("button", {name:"Inspect start"}));
    await waitFor(() => expect(JSON.parse(fetcher.mock.calls.filter(c=>c[0]==="/api/terrain/inspect").at(-1)![1].body).lon).toBeCloseTo(internal));
  }
});

test("loads colorized CTX detail only after the Viking backdrop, preserving alignment and fallback", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:true,json:async () => metadata}));
  render(<Terrain />);
  await screen.findByText(/MOLA test metadata/);
  const map = screen.getByRole("img", {name:/Global Mars map/});
  fireEvent.change(screen.getByLabelText("start latitude"), {target:{value:"18.65"}});
  fireEvent.change(screen.getByLabelText("start longitude"), {target:{value:"226.2"}});
  fireEvent.click(screen.getByRole("button", {name:"Focus start"}));
  for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole("button", {name:/Zoom in/}));
  expect(map.querySelector('image[href*="/ctx/"]')).not.toBeInTheDocument();
  fireEvent.load(map.querySelector('image[href*="/tiles/0/0/0"]')!);
  expect(map.querySelector('image[href*="/ctx/"]')).not.toBeInTheDocument();
  fireEvent.load(map.querySelector('image[href*="/tiles/0/0/1"]')!);
  const detail = map.querySelector('image[href*="/ctx/12/1623/1051"]')!;
  expect(detail.closest(".ctx-color-detail")).toHaveAttribute("opacity", "0.85");
  expect(screen.getByText(/Colorized composite, not natural color/)).toBeVisible();
  expect(detail).toBeInTheDocument();
  expect(map.querySelector('image[href*="/ctx/10/"]')).toBeInTheDocument();
  expect(map.querySelector('image[href*="/tiles/7/"]')).toBeInTheDocument();
  const x = Number(detail.getAttribute("x")), y = Number(detail.getAttribute("y")), span = Number(detail.getAttribute("width"));
  expect(-133.8).toBeGreaterThanOrEqual(x);
  expect(-133.8).toBeLessThan(x + span);
  expect(-18.65).toBeGreaterThanOrEqual(y);
  expect(-18.65).toBeLessThan(y + span);
  fireEvent.error(detail);
  expect(detail).toHaveStyle({visibility:"hidden"});
  expect(screen.getByRole("alert")).toHaveTextContent("coarse CTX or Viking");
  expect(map.querySelector('image[href*="/tiles/7/"]')).toBeInTheDocument();
});

test("frames a diagonal MOLA request including its snapped north-south grid route", async () => {
  // Real MOLA cell centres for this short diagonal: both longitudes share a column.
  const profile = [
    {lat:60.03125,lon:30.03125,elevation_m:-4132,distance_m:0},
    {lat:59.96875,lon:30.03125,elevation_m:-4127,distance_m:3704.4647},
  ];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if(url.endsWith("metadata")) return {ok:true,json:async()=>metadata};
    if(url.endsWith("/route")) {
      const body=JSON.parse(options!.body as string);
      expect(body.start.lat).toBe(60.01);expect(body.end.lat).toBe(59.99);
      expect(body.start.lon).toBeCloseTo(30.001);expect(body.end.lon).toBeCloseTo(30.04);
      return {ok:true,json:async()=>({dataset_id:"mola16",profile,distance_m:3704.4647,ascent_m:5,descent_m:0,
        max_terrain_slope_deg:.15,nominal_cell_m:3704.4613,
        snapping_m:{start:1545.6573,end:1285.9663},unsupported_fraction:0,limitations:[]})};
    }
    return {ok:false,json:async()=>({detail:"Unavailable fixture"})};
  });
  vi.stubGlobal("fetch",fetcher);
  render(<Terrain/>);
  await screen.findByText(/MOLA test metadata/);
  for(const [label,value] of [["start latitude",60.01],["start longitude",30.001],["end latitude",59.99],["end longitude",30.04]])
    fireEvent.change(screen.getByLabelText(label as string),{target:{value:String(value)}});
  fireEvent.click(screen.getByRole("button",{name:"Calculate route"}));
  await screen.findByRole("heading",{name:"3.70 km regional route"});
  const map=screen.getByRole("img",{name:/Global Mars map/});
  const [west,top,width,height]=map.getAttribute("viewBox")!.split(" ").map(Number);
  const line=Array.from(map.querySelectorAll("polyline")).find(p=>Number(p.getAttribute("points")!.split(",")[0])>west)!;
  const vertices=line.getAttribute("points")!.split(" ").map(p=>p.split(",").map(Number));
  expect(vertices).toEqual(profile.map(p=>[p.lon,-p.lat]));
  for(const [x,y] of [...vertices,[30.001,-60.01],[30.04,-59.99]]) {
    expect(x).toBeGreaterThan(west);expect(x).toBeLessThan(west+width);
    expect(y).toBeGreaterThan(top);expect(y).toBeLessThan(top+height);
  }
  expect(screen.getByText(/Start snapped 1.55 km; destination snapped 1.29 km/)).toBeVisible();
  expect(screen.getByText(/Both selected longitudes snap to the same MOLA grid column/)).toBeVisible();
  for(const [label,x,y] of [["S",30.001,-60.01],["D",30.04,-59.99]] as const) {
    const marker=Array.from(map.querySelectorAll("text")).find(t=>t.textContent===label && Math.abs(Number(t.getAttribute("x"))-x)<1e-8)!;
    const circle=marker.parentElement!.querySelector("circle")!;
    expect(Number(circle.getAttribute("cx"))).toBeCloseTo(x);
    expect(Number(circle.getAttribute("cy"))).toBeCloseTo(y);
  }
  // A subsequent unsupported route must clear the old line, not connect markers directly.
  fetcher.mockImplementation(async()=>({ok:false,json:async()=>({detail:"No route within the regional window and slope limit."})}));
  fireEvent.click(screen.getByRole("button",{name:"Calculate route"}));
  await screen.findByText("No route within the regional window and slope limit.");
  expect(map.querySelector("polyline")).toBeNull();
  expect(screen.queryByRole("region",{name:"Route result"})).not.toBeInTheDocument();
});
