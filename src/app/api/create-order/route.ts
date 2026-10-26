import { createPaymentHandlers } from "@/lib/razorpay";
import { auth } from "@/auth";
import { withObservability } from "@/lib/observability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let actor: string | null = null;
  const handlers = createPaymentHandlers({ getUserId: async () => { actor = (await auth())?.user?.id ?? null; return actor; } });
  return withObservability("api.payments.create_order", async () => {
    const response = await handlers.createOrder(request);
    return { actor, response };
  });
}
