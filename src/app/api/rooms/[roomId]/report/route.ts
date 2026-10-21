import { auth, authConfigured } from "@/auth";
import { reportRoom } from "@/lib/chat";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "Expected JSON." }, { status: 415 });
  // Stream with a hard limit; Content-Length alone is not trustworthy.
  if (!request.body) return Response.json({ error: "Choose a reason." }, { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reason: unknown;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024) { await reader.cancel(); return Response.json({ error: "Request too large." }, { status: 413 }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    reason = payload && typeof payload === "object" && "reason" in payload ? payload.reason : undefined;
  } catch {
    return Response.json({ error: "Invalid report." }, { status: 400 });
  }
  try {
    const result = await reportRoom(userId, (await params).roomId, reason);
    if (result === "invalid") return Response.json({ error: "Choose a valid reason." }, { status: 400 });
    if (result === "not_found") return Response.json({ error: "Conversation unavailable." }, { status: 404 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Could not submit your report." }, { status: 500 });
  }
}
