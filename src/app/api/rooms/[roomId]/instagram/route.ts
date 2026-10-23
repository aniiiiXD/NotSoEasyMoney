import { auth, authConfigured } from "@/auth";
import { shareInstagram, withdrawInstagram, type InstagramResult } from "@/lib/chat";
import { isSameOrigin, readJsonWithLimit } from "@/lib/request";

type Context = { params: Promise<{ roomId: string }> };

function respond(result: InstagramResult): Response {
  if (result.ok) return Response.json({ instagram: result.instagram }, { headers: { "Cache-Control": "private, no-store" } });
  const status = result.reason === "not_found" ? 404 : result.reason === "closed" ? 409 : 400;
  const error = result.reason === "not_found" ? "Conversation unavailable."
    : result.reason === "closed" ? "You've already swapped Instagrams."
    : "Use 1–30 letters, numbers, periods or underscores.";
  return Response.json({ error }, { status });
}

async function signedInUser(request: Request): Promise<string | Response> {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  return session.user.id;
}

/** Mark yourself ready to swap with the given handle. */
export async function POST(request: Request, { params }: Context) {
  const userId = await signedInUser(request);
  if (userId instanceof Response) return userId;
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  let input: unknown;
  try { input = await readJsonWithLimit(request, 1024); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const handle = input && typeof input === "object" && "handle" in input ? input.handle : undefined;
  const { roomId } = await params;
  return respond(await shareInstagram(userId, roomId, handle));
}

/** Take your handle back before the other person shares theirs. */
export async function DELETE(request: Request, { params }: Context) {
  const userId = await signedInUser(request);
  if (userId instanceof Response) return userId;
  const { roomId } = await params;
  return respond(await withdrawInstagram(userId, roomId));
}
