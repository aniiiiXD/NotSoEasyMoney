import { createPaymentHandlers } from "@/lib/razorpay";

export const runtime = "nodejs";
export const POST = createPaymentHandlers().webhook;
