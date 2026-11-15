import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import Home from "../app/page";

afterEach(() => vi.unstubAllGlobals());

test("shows Mars scope and sends conversation history", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: "Provider answer fixture" }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Home />);
  expect(screen.getByRole("heading", { name: "Darkstar", level: 1 })).toBeVisible();
  expect(screen.getByText(/No live Mars data/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /What would a Mars habitat/ }));
  expect(screen.getByRole("status")).toHaveTextContent("thinking");
  await screen.findByText("Provider answer fixture");
  fireEvent.change(screen.getByLabelText("Ask about Mars survival"), { target: { value: "What assumptions did you make?" } });
  fireEvent.click(screen.getByRole("button", { name: /Send/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body).messages).toHaveLength(3);
  await waitFor(() => expect(screen.getByRole("button", { name: "New chat" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(screen.queryByText("Provider answer fixture")).not.toBeInTheDocument();
});

test("retains failed question and retries without duplicating history", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ detail: "Provider unavailable" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ reply: "Recovered fixture" }) });
  vi.stubGlobal("fetch", fetcher);
  render(<Home />);
  fireEvent.click(screen.getByRole("button", { name: /What do we know/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Provider unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Recovered fixture");
  expect(JSON.parse(fetcher.mock.calls[1][1].body).messages).toHaveLength(1);
});

test("attaches signed Explorer snapshots and renders server-supplied citations",async()=>{
 sessionStorage.setItem("darkstar-guide-context-v1",JSON.stringify({tokens:{location:"signed-fixture"},mode:"topography"}));
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({reply:"Historical observation [S1].",sources:[{id:"S1",title:"NASA source",url:"https://science.nasa.gov/mars/facts/",kind:"NASA facts"}],context:[{kind:"location",data:{elevation_m:-2567}}],context_warnings:[]})});
 vi.stubGlobal("fetch",fetcher);render(<Home/>);
 fireEvent.click(screen.getByRole("button",{name:"Attach Explorer context"}));
 expect(screen.getByText(/Attached location snapshots/)).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:/What would a Mars habitat/}));
 expect(await screen.findByRole("link",{name:"[S1]"})).toHaveAttribute("href","https://science.nasa.gov/mars/facts/");
 const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.context_tokens).toEqual(["signed-fixture"]);expect(body.map_mode).toBe("topography");
 expect(body).not.toHaveProperty("elevation_m");
 fireEvent.click(screen.getByText("Actual Python results used in this answer"));
 expect(screen.getByText(/"elevation_m": -2567/)).toBeVisible();
 fireEvent.click(screen.getByRole("button",{name:"Detach context"}));
 sessionStorage.clear();
});
