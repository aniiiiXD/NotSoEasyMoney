import { auth } from "@/auth";
import { createPaymentHandlers } from "@/lib/razorpay";

export const runtime = "nodejs";
export const POST = createPaymentHandlers({ getUserId: async () => (await auth())?.user?.id ?? null }).checkStatus;
