import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { decideCandidate, listCandidates } from "@/lib/local-matching";
import { isSameOrigin, readJsonWithLimit, RequestBodyTooLarge } from "@/lib/request";
import { billingSettings, BillingError } from "@/lib/billing-config";
import { observe, withObservability } from "@/lib/observability";

export const runtime = "nodejs";

export async function GET() {
  return withObservability("api.candidates.list", async () => {
    const userId = (await auth())?.user?.id;
    if (!userId) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    const billing = billingSettings();
    const candidates = await listCandidates(getDb(), userId, billing.enabled ? { mode: billing.mode } : undefined);
    if (!candidates) return { actor: userId, response: Response.json({ error: "Finish your profile first." }, { status: 403 }) };
    return {
      actor: userId,
      response: Response.json({ candidates }, { headers: { "Cache-Control": "no-store" } }),
    };
  });
}

export async function POST(request: Request) {
  return withObservability("api.candidates.decide", async () => {
    const userId = (await auth())?.user?.id;
    if (!userId) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    if (!isSameOrigin(request)) return { actor: userId, response: Response.json({ error: "Invalid request origin." }, { status: 403 }) };
    if (!request.headers.get("content-type")?.includes("application/json")) return { actor: userId, response: Response.json({ error: "Expected JSON." }, { status: 415 }) };
    if (Number(request.headers.get("content-length") || 0) > 2048) return { actor: userId, response: Response.json({ error: "Request is too large." }, { status: 413 }) };
    try {
      const body: unknown = await readJsonWithLimit(request, 2048);
      if (!body || typeof body !== "object" || Array.isArray(body)) return { actor: userId, response: Response.json({ error: "Invalid request." }, { status: 400 }) };
      const { candidateId, decision } = body as Record<string, unknown>;
      if (typeof candidateId !== "string" || candidateId.length > 100 || (decision !== "like" && decision !== "pass")) {
        return { actor: userId, response: Response.json({ error: "Invalid decision." }, { status: 400 }) };
      }
      let matchedRoomId: string | undefined;
      const billing = billingSettings();
      const status = await decideCandidate(getDb(), userId, candidateId, decision, (roomId) => {
        // The new room belongs to this signed-in member; let the client open it directly.
        matchedRoomId = roomId;
      }, billing.enabled ? billing.mode : undefined);
      if (status === "unavailable") return { actor: userId, response: Response.json({ error: "This introduction is no longer available." }, { status: 404 }) };
      observe({ kind: "chat.decision", actor: userId, outcome: "ok", detail: { decision, result: status } });
      return {
        actor: userId,
        response: Response.json({ status, ...(matchedRoomId ? { roomId: matchedRoomId } : {}) }, { headers: { "Cache-Control": "private, no-store" } }),
      };
    } catch (error) {
      if (error instanceof BillingError) return { actor: userId, response: Response.json({ error: error.message, code: "PAYMENT_REQUIRED", checkoutUrl: "/checkout" }, { status: error.status }) };
      if (error instanceof RequestBodyTooLarge) return { actor: userId, response: Response.json({ error: "Request is too large." }, { status: 413 }) };
      if (error instanceof SyntaxError || error instanceof TypeError) return { actor: userId, response: Response.json({ error: "Invalid request." }, { status: 400 }) };
      return { actor: userId, response: Response.json({ error: "Could not save your choice. Please try again." }, { status: 500 }) };
    }
  });
}
