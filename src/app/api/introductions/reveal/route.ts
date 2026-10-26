import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { listCandidates } from "@/lib/local-matching";
import { billingSettings, BillingError } from "@/lib/billing-config";
import { withObservability } from "@/lib/observability";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request) {
  return withObservability("api.reveal", async () => {
    const userId = (await auth())?.user?.id;
    if (!userId) return { actor: null, response: Response.json({ error: "Sign in to continue." }, { status: 401 }) };
    if (!isSameOrigin(request)) return { actor: userId, response: Response.json({ error: "Invalid request origin." }, { status: 403 }) };
    try {
      const billing = billingSettings();
      const candidates = await listCandidates(getDb(), userId, billing.enabled ? { mode: billing.mode, reveal: true } : undefined);
      if (!candidates) return { actor: userId, response: Response.json({ error: "Finish your profile first." }, { status: 403 }) };
      return {
        actor: userId,
        response: Response.json({ candidates }, { headers: { "Cache-Control": "private, no-store" } }),
      };
    } catch (error) {
      if (error instanceof BillingError) return { actor: userId, response: Response.json({ error: error.message, checkoutUrl: "/checkout" }, { status: error.status }) };
      return { actor: userId, response: Response.json({ error: "Could not reveal an introduction. Please try again; your payment is saved." }, { status: 500 }) };
    }
  });
}
