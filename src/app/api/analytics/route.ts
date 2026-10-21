import { auth } from "@/auth";
import { getAnalyticsReport, isAnalyticsAdmin } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  if (!isAnalyticsAdmin(userId)) {
    return Response.json({ error: "Access denied" }, { status: 403, headers });
  }
  try {
    return Response.json(await getAnalyticsReport(userId), { headers });
  } catch {
    return Response.json({ error: "Analytics unavailable" }, { status: 500, headers });
  }
}
