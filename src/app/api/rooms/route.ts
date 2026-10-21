import { auth, authConfigured } from "@/auth";
import { listRooms } from "@/lib/chat";

export async function GET() {
  if (!authConfigured) return Response.json({ error: "Sign-in is not configured." }, { status: 503 });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({ rooms: listRooms(session.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
