import { createPaymentHandlers } from "@/lib/razorpay";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const POST = createPaymentHandlers({ getUserId: async () => (await auth())?.user?.id ?? null }).verifyPayment;
