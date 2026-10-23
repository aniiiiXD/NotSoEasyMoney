import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { listCandidates } from "@/lib/local-matching";
import { billingSettings, BillingError } from "@/lib/billing-config";
import { isSameOrigin } from "@/lib/request";

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const billing = billingSettings();
    const candidates = await listCandidates(getDb(), userId, billing.enabled ? { mode: billing.mode, reveal: true } : undefined);
    if (!candidates) return Response.json({ error: "Finish your profile first." }, { status: 403 });
    return Response.json({ candidates }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.message, checkoutUrl: "/checkout" }, { status: error.status });
    return Response.json({ error: "Could not reveal an introduction. Please try again; your payment is saved." }, { status: 500 });
  }
}
