import { createHash } from "node:crypto";
import Razorpay from "razorpay";
import { BillingError } from "./billing-config.ts";
import { getDb, withTransaction } from "./db.ts";

export const PAYMENT_EVENTS = ["payment.authorized", "payment.captured", "payment.failed", "order.paid", "refund.processed"];
type Credentials = { keyId: string; keySecret: string; webhookSecret: string };
const ready = new Map<string, { expires: number; operation: Promise<void> }>();

export async function provisionPaymentWebhook(credentials: Credentials, origin: string) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new BillingError("The public payment URL is not configured.", 503);
  const url = new URL("/api/payments/razorpay/webhook", base).href;
  const api = new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret });
  const existing = (await api.webhooks.all({ count: 100 })).items.find(hook => hook.url === url);
  // Merchant v1 uses event names as keys; partner v2 uses an array.
  const data = { url, secret: credentials.webhookSecret, events: Object.fromEntries(PAYMENT_EVENTS.map(event => [event, true])), active: "true" };
  return existing ? api.webhooks.edit(data, existing.id) : api.webhooks.create(data);
}

/** Register the correct Test/Live webhook before the first order after a key change. */
export async function preparePaymentCheckout(credentials: Credentials) {
  const origin = process.env.APP_URL || "";
  // Local sandbox checkout is verified with signed replay; providers cannot
  // deliver notifications to a loopback URL. Never permit this for live keys.
  if (credentials.keyId.startsWith("rzp_test_") && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return;
  const key = createHash("sha256").update(JSON.stringify([origin, credentials])).digest("hex");
  const cached = ready.get(key);
  if (cached && cached.expires > Date.now()) return cached.operation;
  const operation = withTransaction(getDb(), async client => {
    // Prevent separate Vercel instances creating duplicate merchant webhooks.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`payment-webhook:${credentials.keyId}`]);
    await provisionPaymentWebhook(credentials, origin);
  });
  ready.set(key, { expires: Date.now() + 60 * 60 * 1000, operation });
  try { await operation; } catch (error) { ready.delete(key); throw error; }
}
