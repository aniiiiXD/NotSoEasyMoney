import { getDb } from "@/lib/db";
import { createReferral, listReferralSummaries, setReferralActive } from "@/lib/referrals";
import { isSameOrigin, readJsonWithLimit, RequestBodyTooLarge } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  try { return Response.json({ referrals: await listReferralSummaries(getDb()) }, { headers }); }
  catch { return Response.json({ error: "Could not load referral links." }, { status: 500, headers }); }
}

async function mutate(request: Request, method: "create" | "update") {
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return Response.json({ error: "Expected JSON." }, { status: 415, headers });
  let body: unknown;
  try { body = await readJsonWithLimit(request, 2048); }
  catch (error) { return Response.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  const input = body as Record<string, unknown>;
  try {
    const result = method === "create" ? await createReferral(getDb(), input.code, input.label) : await setReferralActive(getDb(), input.code, input.active);
    if (result === "invalid") return Response.json({ error: "Use a code of 3–32 letters, numbers, hyphens or underscores, and a name of up to 80 characters." }, { status: 400, headers });
    if (result === "exists") return Response.json({ error: "That code already exists. Try another." }, { status: 409, headers });
    if (result === "not_found") return Response.json({ error: "Referral code not found." }, { status: 404, headers });
    return Response.json({ referrals: await listReferralSummaries(getDb()) }, { status: method === "create" ? 201 : 200, headers });
  } catch { return Response.json({ error: "Could not save the referral link." }, { status: 500, headers }); }
}
export async function POST(request: Request) { return mutate(request, "create"); }
export async function PATCH(request: Request) { return mutate(request, "update"); }
