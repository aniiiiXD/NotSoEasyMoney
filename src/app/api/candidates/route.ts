import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { decideCandidate, listCandidates } from "@/lib/local-matching";
import { isSameOrigin } from "@/lib/request";
import { recordMatchEvent } from "@/lib/analytics";

export const runtime = "nodejs";

export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const candidates = listCandidates(getDb(), userId);
  if (!candidates) return Response.json({ error: "Finish your profile first." }, { status: 403 });
  return Response.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 2048) return Response.json({ error: "Request is too large." }, { status: 413 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { candidateId, decision } = body as Record<string, unknown>;
    if (typeof candidateId !== "string" || candidateId.length > 100 || (decision !== "like" && decision !== "pass")) return Response.json({ error: "Invalid decision." }, { status: 400 });
    let matchedRoomId: string | undefined;
    const status = decideCandidate(getDb(), userId, candidateId, decision, (roomId, firstUserId, secondUserId) => {
      // The new room belongs to this signed-in member; let the client open it directly.
      matchedRoomId = roomId;
      recordMatchEvent(firstUserId, roomId);
      recordMatchEvent(secondUserId, roomId);
    });
    return status === "unavailable" ? Response.json({ error: "This introduction is no longer available." }, { status: 404 }) : Response.json({ status, ...(matchedRoomId ? { roomId: matchedRoomId } : {}) });
  } catch {
    return Response.json({ error: "Could not save your choice. Please try again." }, { status: 500 });
  }
}
