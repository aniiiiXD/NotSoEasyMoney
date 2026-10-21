import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile, saveProfile } from "@/lib/local-matching";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";

export async function GET() {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  return Response.json({ profile: await getOwnProfile(getDb(), userId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "Expected JSON." }, { status: 415 });
  if (Number(request.headers.get("content-length") || 0) > 16384) return Response.json({ error: "Profile is too large." }, { status: 413 });
  try {
    const result = await saveProfile(getDb(), userId, await request.json());
    return Response.json(result);
  } catch (error) {
    if (error instanceof TypeError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Could not save your profile. Please try again." }, { status: 500 });
  }
}
