import { auth } from "@/auth";
import { getAnalyticsConsent, setAnalyticsConsent } from "@/lib/analytics";
import { isSameOrigin } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  try {
    const enabled = getAnalyticsConsent(userId);
    if (enabled === null) return Response.json({ error: "Create a profile first" }, { status: 404, headers });
    return Response.json({ enabled }, { headers });
  } catch {
    return Response.json({ error: "Preference unavailable" }, { status: 500, headers });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in required" }, { status: 401, headers });

  // The session cookie authorizes this request. Require a same-origin browser
  // request as an additional CSRF defense, even when the caller is signed in.
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Invalid request origin" }, { status: 403, headers });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "Expected JSON" }, { status: 415, headers });
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > 512) return Response.json({ error: "Request too large" }, { status: 413, headers });
    input = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400, headers });
  }
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !("enabled" in input) ||
    typeof input.enabled !== "boolean"
  ) {
    return Response.json({ error: "Expected an enabled boolean" }, { status: 400, headers });
  }
  try {
    if (!setAnalyticsConsent(userId, input.enabled)) {
      return Response.json({ error: "Create a profile first" }, { status: 404, headers });
    }
    return Response.json({ enabled: input.enabled }, { headers });
  } catch {
    return Response.json({ error: "Could not save preference" }, { status: 500, headers });
  }
}
