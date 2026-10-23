import { createHmac, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";
import { billingSettings, BillingError } from "./billing-config.ts";
import { createPaymentStore, type GatewayOrder, type GatewayPayment, type PaymentStore, type StoredOrder } from "./payment-store.ts";
import { isSameOrigin, readBytesWithLimit, readJsonWithLimit, RequestBodyTooLarge } from "./request.ts";
import { preparePaymentCheckout } from "./payment-webhook.ts";

export type PaymentGateway = {
  orders: {
    create(input: { amount: number; currency: string; receipt: string }): Promise<GatewayOrder>;
    fetchPayments(orderId: string): Promise<{ items: GatewayPayment[] }>;
  };
  payments: { fetch(id: string): Promise<GatewayPayment> };
};
type Config = { keyId: string; keySecret: string; webhookSecret: string };

export function getPaymentConfig(): Config {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
  if (!keyId || !keySecret || !webhookSecret) throw new BillingError("Payments are not configured yet. Your profile is saved; please try again later.", 503);
  return { keyId, keySecret, webhookSecret };
}

function matchesHex(expected: string, actual: string): boolean {
  return /^[a-f0-9]{64}$/i.test(actual) && timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  return matchesHex(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), signature);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!isSameOrigin(request)) throw new BillingError("Invalid request origin.", 403);
  if (!request.headers.get("content-type")?.includes("application/json")) throw new BillingError("Expected JSON.", 415);
  let body: unknown;
  try { body = await readJsonWithLimit(request, 2048); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new BillingError("Invalid payment request.", 400);
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new BillingError("Expected a JSON object.", 400);
  return body as Record<string, unknown>;
}

function failure(error: unknown): Response {
  if (error instanceof BillingError) return json({ error: error.message }, error.status);
  if (error instanceof RequestBodyTooLarge) return json({ error: "Payment request is too large." }, 413);
  if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 401) return json({ error: "Razorpay authentication failed. Please contact support." }, 401);
  return json({ error: "Payment service is unavailable. Please try again." }, 500);
}

async function withinDeadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Payment service timeout")), 20000); })]); }
  finally { clearTimeout(timer); }
}

export function createPaymentHandlers(dependencies: {
  getConfig?: () => Config;
  getGateway?: (config: Config) => PaymentGateway;
  getSettings?: typeof billingSettings;
  getUserId?: (request: Request) => Promise<string | null>;
  store?: PaymentStore;
  prepareCheckout?: (credentials: Config) => Promise<void>;
} = {}) {
  const config = dependencies.getConfig ?? getPaymentConfig;
  const settings = dependencies.getSettings ?? billingSettings;
  const gateway = dependencies.getGateway ?? ((credentials: Config): PaymentGateway => new Razorpay({ key_id: credentials.keyId, key_secret: credentials.keySecret }));
  const store = dependencies.store ?? createPaymentStore();
  const user = dependencies.getUserId ?? (async () => null);
  const prepareCheckout = dependencies.prepareCheckout ?? preparePaymentCheckout;
  async function signedIn(request: Request) {
    const userId = await user(request);
    if (!userId) throw new BillingError("Sign in to continue.", 401);
    return userId;
  }
  async function reconcile(order: StoredOrder, api: PaymentGateway) {
    const payments = await withinDeadline(api.orders.fetchPayments(order.order_id));
    for (const payment of payments.items) {
      if (payment.order_id !== order.order_id) throw new BillingError("Unexpected order payment.", 400);
      await store.applyPayment(payment, order.mode);
    }
  }

  return {
    async createOrder(request: Request): Promise<Response> {
      try {
        const userId = await signedIn(request);
        const body = await readBody(request);
        const item = settings();
        if (!item.enabled) throw new BillingError("Paid introductions are not enabled.", 403);
        if (body.amount !== undefined && (typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount < 100)) throw new BillingError("Amount must be an integer of at least 100 paise.", 400);
        if (body.amount !== undefined && body.amount !== item.amount) throw new BillingError("The price has changed. Refresh checkout and try again.", 400);
        if (body.currency !== undefined && body.currency !== "INR") throw new BillingError("Only INR is supported.", 400);
        const credentials = config();
        if (await store.hasAccess(userId, item.mode)) return json({ already_paid: true });
        const api = gateway(credentials);
        const pending = await store.pendingOrder(userId, credentials.keyId);
        if (pending) {
          await reconcile(pending, api);
          const reconciled = await store.getOrder(pending.order_id, userId);
          if (reconciled?.status === "paid") return json({ already_paid: true });
          if (reconciled?.status === "authorized") return json({ pending: true, order_id: reconciled.order_id });
        }
        await withinDeadline(prepareCheckout(credentials));
        const order = await store.createOrder(userId, { keyId: credentials.keyId, mode: item.mode, amount: item.amount, currency: "INR" }, receipt => withinDeadline(api.orders.create({ amount: item.amount, currency: "INR", receipt })));
        if (!order) return json({ already_paid: true });
        return json({ order_id: order.order_id, amount: order.amount, currency: order.currency, key_id: credentials.keyId });
      } catch (error) { return failure(error); }
    },

    async verifyPayment(request: Request): Promise<Response> {
      try {
        const userId = await signedIn(request);
        const body = await readBody(request);
        const orderId = body.razorpay_order_id;
        const paymentId = body.razorpay_payment_id;
        const signature = body.razorpay_signature;
        if (typeof orderId !== "string" || !/^order_[a-zA-Z0-9]+$/.test(orderId) || typeof paymentId !== "string" || !/^pay_[a-zA-Z0-9]+$/.test(paymentId) || typeof signature !== "string" || !signature) throw new BillingError("Payment ID, order ID and signature are required.", 400);
        const credentials = config();
        const order = await store.getOrder(orderId, userId);
        if (!order) throw new BillingError("This order does not belong to your account.", 404);
        if (!verifyPaymentSignature(order.order_id, paymentId, signature, credentials.keySecret)) throw new BillingError("Payment signature does not match. Payment was not verified.", 400);
        const payment = await withinDeadline(gateway(credentials).payments.fetch(paymentId));
        if (payment.id !== paymentId || payment.order_id !== order.order_id || !["authorized", "captured"].includes(payment.status) || (payment.status === "captured" && !payment.captured)) throw new BillingError("Payment was not successful for this order.", 400);
        const saved = await store.applyPayment(payment, settings().mode);
        return json({ success: true, order_id: order.order_id, payment_id: paymentId, status: saved?.status, paid: saved?.status === "paid" });
      } catch (error) { return failure(error); }
    },

    async checkStatus(request: Request): Promise<Response> {
      try {
        const userId = await signedIn(request);
        await readBody(request);
        const item = settings();
        if (!item.enabled) return json({ access: true, enabled: false });
        if (await store.hasAccess(userId, item.mode)) return json({ access: true, enabled: true, status: "paid" });
        const credentials = config();
        const pending = await store.pendingOrder(userId, credentials.keyId);
        if (pending) await reconcile(pending, gateway(credentials));
        return json({ access: await store.hasAccess(userId, item.mode), enabled: true, status: pending ? (await store.getOrder(pending.order_id, userId))?.status : undefined });
      } catch (error) { return failure(error); }
    },

    async webhook(request: Request): Promise<Response> {
      try {
        const credentials = config();
        const bytes = await readBytesWithLimit(request, 65536);
        const signature = request.headers.get("x-razorpay-signature") || "";
        if (!matchesHex(createHmac("sha256", credentials.webhookSecret).update(bytes).digest("hex"), signature)) throw new BillingError("Invalid webhook signature.", 400);
        let event: { event?: string; payload?: { payment?: { entity?: { id?: string } }; refund?: { entity?: { payment_id?: string } } } };
        try { event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
        catch { throw new BillingError("Invalid webhook payload.", 400); }
        if (!event || !["payment.authorized", "payment.captured", "payment.failed", "order.paid", "refund.processed"].includes(event.event || "")) return json({ received: true, ignored: true });
        const paymentId = event.payload?.payment?.entity?.id || event.payload?.refund?.entity?.payment_id;
        if (!paymentId || !/^pay_[a-zA-Z0-9]+$/.test(paymentId)) throw new BillingError("Missing payment ID.", 400);
        // Payloads are historical notifications. Confirm the provider's current state.
        const payment = await withinDeadline(gateway(credentials).payments.fetch(paymentId));
        if (payment.id !== paymentId) throw new BillingError("Unexpected payment response.", 400);
        const saved = await store.applyPayment(payment, settings().mode);
        return json({ received: true, ignored: !saved });
      } catch (error) { return failure(error); }
    },
  };
}
