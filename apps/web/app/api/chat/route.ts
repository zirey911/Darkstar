export const maxDuration = 120;

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const raw = await request.text();
    if (raw.length > 250000) {
      return Response.json({ detail: "Conversation is too large. Start a new chat." }, { status: 413, headers });
    }
    const body = JSON.parse(raw);
    const base = process.env.NAVIGATION_URL || process.env.DARKSTAR_API_URL || "http://127.0.0.1:8000";
    const response = await fetch(`${base.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(50000),
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = response.status === 422
        ? "Conversation limit or invalid message. Start a new chat or shorten your question."
        : typeof data.detail === "string" ? data.detail : "Chat request failed. Please retry.";
      return Response.json({ detail }, { status: response.status, headers });
    }
    if (typeof data.reply !== "string" || !data.reply.trim()) throw new Error("Invalid reply");
    return Response.json({ reply: data.reply,
      ...(Array.isArray(data.sources)?{sources:data.sources}:{}),
      ...(Array.isArray(data.context)?{context:data.context}:{}),
      ...(Array.isArray(data.context_warnings)?{context_warnings:data.context_warnings}:{}),
      ...(typeof data.grounding_status==="string"?{grounding_status:data.grounding_status}:{}),
    }, { headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError;
    return Response.json({ detail: invalid ? "Invalid chat request or response." : "Chat backend unavailable. Check that the Python service is running, then retry." }, { status: invalid ? 502 : 503, headers });
  }
}
