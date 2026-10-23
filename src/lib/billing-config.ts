export type PaymentMode = "test" | "live";
export class BillingError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export function billingSettings(env: Record<string, string | undefined> = process.env) {
  const flag = env.DISCOVERY_PAYWALL_ENABLED?.trim().toLowerCase() || "false";
  if (!["true", "false"].includes(flag)) throw new BillingError("Payment access is temporarily unavailable.", 503);
  const enabled = flag === "true";
  const price = env.DISCOVERY_PRICE_PAISE?.trim() || "2000";
  const amount = Number(price);
  if (enabled && (!/^\d+$/.test(price) || !Number.isSafeInteger(amount) || amount < 100 || amount > 10000000)) throw new BillingError("Payment pricing is not configured. Please contact support.", 503);
  const keyId = env.RAZORPAY_KEY_ID?.trim() || "";
  const mode: PaymentMode = keyId.startsWith("rzp_live_") ? "live" : "test";
  const configured = /^rzp_(test|live)_[a-zA-Z0-9]+$/.test(keyId) && Boolean(env.RAZORPAY_KEY_SECRET?.trim() && env.RAZORPAY_WEBHOOK_SECRET?.trim());
  return { enabled, amount, currency: "INR", mode, configured } as const;
}

export function formatPaymentAmount(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(amount / 100);
}
