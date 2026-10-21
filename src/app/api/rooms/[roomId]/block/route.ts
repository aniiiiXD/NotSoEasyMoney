import { auth, authConfigured } from "@/auth";
import { blockRoom } from "@/lib/chat";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403 });
  const { roomId } = await params;
  if (!blockRoom(session.user.id, roomId)) return Response.json({ error: "Conversation unavailable." }, { status: 404 });
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
