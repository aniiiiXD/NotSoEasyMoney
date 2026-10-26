import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile, saveProfile } from "@/lib/local-matching";
import { isSameOrigin, readJsonWithLimit, RequestBodyTooLarge } from "@/lib/request";
import { discoveryAccess } from "@/lib/discovery-access";
import { withObservability } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET() {
  return withObservability("api.profile.read", async () => {
    const userId = (await auth())?.user?.id;
    if (!userId) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    return {
      actor: userId,
      response: Response.json({ profile: await getOwnProfile(getDb(), userId) }, { headers: { "Cache-Control": "no-store" } }),
    };
  });
}

export async function POST(request: Request) {
  return withObservability("api.profile.save", async () => {
    const userId = (await auth())?.user?.id;
    if (!userId) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    if (!isSameOrigin(request)) return { actor: userId, response: Response.json({ error: "Invalid request origin." }, { status: 403 }) };
    if (!request.headers.get("content-type")?.includes("application/json")) return { actor: userId, response: Response.json({ error: "Expected JSON." }, { status: 415 }) };
    if (Number(request.headers.get("content-length") || 0) > 16384) return { actor: userId, response: Response.json({ error: "Profile is too large." }, { status: 413 }) };
    try {
      const result = await saveProfile(getDb(), userId, await readJsonWithLimit(request, 16384));
      const access = await discoveryAccess(userId);
      return {
        actor: userId,
        response: Response.json({ ...result, nextUrl: access.allowed ? "/discover" : "/checkout" }, { headers: { "Cache-Control": "private, no-store" } }),
      };
    } catch (error) {
      if (error instanceof RequestBodyTooLarge) return { actor: userId, response: Response.json({ error: "Profile is too large." }, { status: 413 }) };
      if (error instanceof TypeError || error instanceof SyntaxError) return { actor: userId, response: Response.json({ error: error.message }, { status: 400 }) };
      return { actor: userId, response: Response.json({ error: "Could not save your profile. Please try again." }, { status: 500 }) };
    }
  });
}
