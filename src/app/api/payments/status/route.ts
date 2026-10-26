import { auth } from "@/auth";
import { createPaymentHandlers } from "@/lib/razorpay";
import { withObservability } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let actor: string | null = null;
  const handlers = createPaymentHandlers({ getUserId: async () => { actor = (await auth())?.user?.id ?? null; return actor; } });
  return withObservability("api.payments.status", async () => {
    const response = await handlers.checkStatus(request);
    return { actor, response };
  });
}
