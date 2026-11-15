export const maxDuration = 120;

import { NextRequest } from "next/server";

type Context = { params: Promise<{ path: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const endpoint = path.join("/");
  const valid = request.method === "GET"
    ? ["metadata", "region-map"].includes(endpoint) || /^geology\/[2-6]\/\d{1,2}\/\d{1,2}$/.test(endpoint) || (/^(tiles|topography)\/[0-7]\/\d{1,3}\/\d{1,3}$/.test(endpoint) || /^ctx\/(?:[0-9]|1[0-2])\/\d{1,4}\/\d{1,4}$/.test(endpoint))
    : ["route", "inspect", "mesh", "marswalk", "geology-inspect", "environment"].includes(endpoint);
  if (!valid) return Response.json({ detail: "Unknown terrain endpoint." }, { status: 404 });
  try {
    const body = request.method === "POST" ? await request.text() : undefined;
    if (body && body.length > 4000) return Response.json({ detail: "Request too large." }, { status: 413 });
    const base = (process.env.NAVIGATION_URL || process.env.DARKSTAR_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/terrain/${endpoint}`, {
      method: request.method, body, headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(endpoint === "marswalk" ? 70000 : endpoint === "route" ? 35000 : 20000), cache: "no-store",
    });
    if (response.ok && (endpoint.startsWith("geology/") || endpoint.startsWith("ctx/") || endpoint.startsWith("tiles/") || endpoint.startsWith("topography/") || endpoint === "region-map")) {
      return new Response(await response.arrayBuffer(), { headers: { "Content-Type": response.headers.get("Content-Type") || "image/png", "Cache-Control": (endpoint.startsWith("topography/") || endpoint === "region-map") ? "no-cache" : "public, max-age=86400" } });
    }
    const data = await response.json();
    if (!response.ok && typeof data.detail !== "string") data.detail = "Invalid coordinates or routing settings.";
    return Response.json(data, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ detail: "Terrain service unavailable or timed out. Check the Python backend." }, { status: 503 });
  }
}
export const GET = proxy;
export const POST = proxy;
