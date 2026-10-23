import { auth, authConfigured } from "@/auth";
import { listRooms } from "@/lib/chat";
import { withObservability } from "@/lib/observability";

export async function GET() {
  return withObservability("api.rooms.list", async () => {
    if (!authConfigured) return { actor: null, response: Response.json({ error: "Sign-in is not configured." }, { status: 503 }) };
    const session = await auth();
    if (!session?.user?.id) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    const response = Response.json({ rooms: await listRooms(session.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
    return { actor: session.user.id, response };
  });
}
