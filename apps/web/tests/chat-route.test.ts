import { afterEach, expect, test, vi } from "vitest";
import { POST } from "../app/api/chat/route";

afterEach(() => vi.unstubAllGlobals());
const request = () => new Request("http://localhost/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "Mars?" }] }) });

test("forwards chat through the server", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ reply: "Fixture" }));
  vi.stubGlobal("fetch", fetcher);
  const response = await POST(request());
  expect(await response.json()).toEqual({ reply: "Fixture" });
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:8000/chat");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

test("returns a useful backend-unavailable error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect((await response.json()).detail).toMatch(/Python service/);
});

test("preserves verified citations and context returned by Python",async()=>{
 const body={reply:"Evidence [S1]",sources:[{id:"S1",title:"NASA",url:"https://science.nasa.gov/mars/facts/",kind:"NASA facts"}],context:[],context_warnings:["Expired snapshot"],grounding_status:"checked"};
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json(body)));
 expect(await (await POST(request())).json()).toEqual(body);
});
