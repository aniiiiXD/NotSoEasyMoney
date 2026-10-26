import { auth, authConfigured } from "@/auth";
import { blockRoom } from "@/lib/chat";
import { withObservability } from "@/lib/observability";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  return withObservability("api.room.block", async () => {
    if (!authConfigured) return { actor: null, response: Response.json({ error: "Sign-in is not configured." }, { status: 503 }) };
    const session = await auth();
    if (!session?.user?.id) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    if (!isSameOrigin(request)) return { actor: session.user.id, response: Response.json({ error: "Invalid origin." }, { status: 403 }) };
    const { roomId } = await params;
    if (!await blockRoom(session.user.id, roomId)) {
      return { actor: session.user.id, response: Response.json({ error: "Conversation unavailable." }, { status: 404 }) };
    }
    return { actor: session.user.id, response: new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } }) };
  });
}
