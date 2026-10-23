import { createPaymentHandlers } from "@/lib/razorpay";
import { withObservability } from "@/lib/observability";

export const runtime = "nodejs";

// Provider-originated: no browser session, so no actor. Signature verification
// and provider re-fetch happen inside the handler.
export async function POST(request: Request) {
  const handlers = createPaymentHandlers();
  return withObservability("api.payments.webhook", async () => {
    const response = await handlers.webhook(request);
    return { actor: null, response };
  });
}
