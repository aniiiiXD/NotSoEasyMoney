import { auth, authConfigured } from "@/auth";
import { readRoom, sendMessage } from "@/lib/chat";
import { isSameOrigin } from "@/lib/request";

type Context = { params: Promise<{ roomId: string }> };

export async function GET(_request: Request, { params }: Context) {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  const { roomId } = await params;
  const room = await readRoom(session.user.id, roomId);
  if (!room) return Response.json({ error: "Conversation unavailable." }, { status: 404 });
  return Response.json(room, { headers: { "Cache-Control": "private, no-store" } });
}

async function readLimitedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); throw new Error("Body too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function POST(request: Request, { params }: Context) {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  // A cross-origin site must not be able to send messages using the user's cookies.
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return Response.json({ error: "Expected JSON." }, { status: 415 });
  }
  let input: unknown;
  try { input = await readLimitedJson(request); } catch { return Response.json({ error: "Invalid message." }, { status: 400 }); }
  const { roomId } = await params;
  const body = input && typeof input === "object" && "body" in input ? input.body : undefined;
  const result = await sendMessage(session.user.id, roomId, body);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "rate_limited" ? 429 : result.reason === "closed" ? 409 : 400;
    const error = result.reason === "not_found" ? "Conversation unavailable." : result.reason === "rate_limited" ? "Please slow down and try again." : result.reason === "closed" ? "You swapped Instagrams, so this conversation is closed." : "Write a message of up to 2,000 characters.";
    return Response.json({ error }, { status });
  }
  return Response.json({ message: result.message }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
