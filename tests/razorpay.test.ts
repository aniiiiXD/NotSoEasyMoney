import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { billingSettings } from "../src/lib/billing-config.ts";
import { createPaymentHandlers, verifyPaymentSignature, type PaymentGateway } from "../src/lib/razorpay.ts";
import type { PaymentStore, StoredOrder } from "../src/lib/payment-store.ts";

const secret = "disposable-payment-test-secret";
const webhookSecret = "different-disposable-webhook-secret";
const orderId = "order_checkoutTest";
const paymentId = "pay_checkoutTest";
const signature = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
const proof = { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature };
function request(path: string, body: unknown, origin = "http://127.0.0.1:3000") {
  return new Request(`${origin}${path}`, { method: "POST", headers: { host: new URL(origin).host, origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}
function fixture() {
  let userId: string | null = "google:owner";
  let enabled = true;
  let creates = 0;
  let applies = 0;
  const order: StoredOrder = { order_id: orderId, user_id: "google:owner", key_id: "rzp_test_disposable", amount: 2000, currency: "INR", mode: "test", status: "created", payment_id: null, amount_refunded: 0 };
  const payment = { id: paymentId, order_id: orderId, amount: 2000, currency: "INR", status: "captured", captured: true, amount_refunded: 0 };
  const api: PaymentGateway = {
    orders: { async create(input) { creates++; assert.equal(input.amount, 2000); assert.equal(input.currency, "INR"); return { id: orderId, amount: input.amount, currency: input.currency }; }, async fetchPayments() { return { items: [payment] }; } },
    payments: { async fetch() { return payment; } },
  };
  const store: PaymentStore = {
    async hasAccess() { return order.status === "paid"; }, async pendingOrder() { return null; },
    async getOrder(id, owner) { return id === orderId && (!owner || owner === order.user_id) ? order : null; },
    async createOrder(_userId, _item, create) { await create("mm_testReceipt"); return order; },
    async applyPayment() { applies++; return { ...order, status: "paid" }; },
  };
  const handlers = createPaymentHandlers({
    getUserId: async () => userId, store, getGateway: () => api, prepareCheckout: async () => {},
    getConfig: () => ({ keyId: "rzp_test_disposable", keySecret: secret, webhookSecret }),
    getSettings: () => billingSettings({ DISCOVERY_PAYWALL_ENABLED: String(enabled), DISCOVERY_PRICE_PAISE: "2000", RAZORPAY_KEY_ID: "rzp_test_disposable", RAZORPAY_KEY_SECRET: secret, RAZORPAY_WEBHOOK_SECRET: webhookSecret }),
  });
  return { handlers, api, store, order, payment, setUser: (id: string | null) => { userId = id; }, setEnabled: (value: boolean) => { enabled = value; }, counts: () => ({ creates, applies }) };
}
function webhook(body: string, valid = true) {
  return new Request("http://localhost/api/payments/razorpay/webhook", { method: "POST", headers: { "x-razorpay-signature": valid ? createHmac("sha256", webhookSecret).update(body).digest("hex") : "0".repeat(64) }, body });
}

test("anonymous payment endpoints fail closed and flag-off prevents order creation", async () => {
  const f = fixture(); f.setUser(null);
  for (const handler of [f.handlers.createOrder, f.handlers.verifyPayment, f.handlers.checkStatus]) assert.equal((await handler(request("/api", {}))).status, 401);
  f.setUser("google:owner"); f.setEnabled(false);
  assert.equal((await f.handlers.createOrder(request("/api", {}))).status, 403);
  assert.equal(f.counts().creates, 0);
});
test("orders use the configured server price and reject manipulated amounts/currency", async () => {
  const f = fixture();
  for (const amount of [0, 99, 100, "2000", 2000.5]) assert.equal((await f.handlers.createOrder(request("/api", { amount }))).status, 400);
  assert.equal((await f.handlers.createOrder(request("/api", { amount: 2000, currency: "USD" }))).status, 400);
  assert.equal(f.counts().creates, 0);
  const response = await f.handlers.createOrder(request("/api", {}));
  assert.deepEqual(await response.json(), { order_id: orderId, amount: 2000, currency: "INR", key_id: "rzp_test_disposable" });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
test("same-origin JSON and streamed body limits apply before contacting the provider", async () => {
  const f = fixture();
  for (const handler of [f.handlers.createOrder, f.handlers.verifyPayment, f.handlers.checkStatus]) {
    assert.equal((await handler(new Request("http://localhost/api", { method: "POST", body: "{}" }))).status, 403);
    assert.equal((await handler(request("/api", []))).status, 400);
    assert.equal((await handler(request("/api", { huge: "x".repeat(2500) }))).status, 413);
  }
});
test("correct HMAC is required, including malformed/different-length signatures", async () => {
  assert.equal(verifyPaymentSignature(orderId, paymentId, signature, secret), true);
  for (const invalid of ["", "a", "x".repeat(64), "0".repeat(64), signature + "0"]) assert.equal(verifyPaymentSignature(orderId, paymentId, invalid, secret), false);
  const f = fixture();
  assert.equal((await f.handlers.verifyPayment(request("/api", {}))).status, 400);
  assert.equal((await f.handlers.verifyPayment(request("/api", { ...proof, razorpay_signature: "0".repeat(64) }))).status, 400);
  assert.equal(f.counts().applies, 0);
});
test("a valid signed payment cannot be claimed by another account", async () => {
  const f = fixture(); f.setUser("google:other");
  assert.equal((await f.handlers.verifyPayment(request("/api", proof))).status, 404);
  assert.equal(f.counts().applies, 0);
});
test("capture is persisted before success; wrong provider order/failure never grants access", async () => {
  const f = fixture();
  const response = await f.handlers.verifyPayment(request("/api", proof));
  assert.equal(response.status, 200); assert.equal((await response.json()).paid, true); assert.equal(f.counts().applies, 1);
  for (const override of [{ order_id: "order_other" }, { id: "pay_other" }, { status: "failed" }, { captured: false }]) {
    const other = fixture(); Object.assign(other.payment, override);
    assert.equal((await other.handlers.verifyPayment(request("/api", proof))).status, 400); assert.equal(other.counts().applies, 0);
  }
});
test("an authorized payment stays unpaid and confirmation can retry after a provider outage", async () => {
  const f = fixture(); f.payment.status = "authorized"; f.payment.captured = false;
  f.store.applyPayment = async () => ({ ...f.order, status: "authorized" });
  assert.equal((await (await f.handlers.verifyPayment(request("/api", proof))).json()).paid, false);
  const fetch = f.api.payments.fetch;
  f.api.payments.fetch = async () => { throw { statusCode: 500 }; };
  assert.equal((await f.handlers.verifyPayment(request("/api", proof))).status, 500);
  f.api.payments.fetch = fetch;
  assert.equal((await f.handlers.verifyPayment(request("/api", proof))).status, 200);
});
test("provider errors stay private and authentication failures return 401", async () => {
  const f = fixture();
  for (const statusCode of [401, 500]) {
    f.api.orders.create = async () => { throw { statusCode, error: { description: secret } }; };
    const response = await f.handlers.createOrder(request("/api", {}));
    assert.equal(response.status, statusCode); assert.ok(!(await response.text()).includes(secret));
  }
});
test("webhooks validate exact raw bytes and reject invalid/oversized payloads", async () => {
  const f = fixture(); const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId } } } }, null, 2);
  assert.equal((await f.handlers.webhook(webhook(body, false))).status, 400);
  const signed = webhook(body); const signatureHeader = signed.headers.get("x-razorpay-signature")!;
  assert.equal((await f.handlers.webhook(new Request(signed.url, { method: "POST", headers: { "x-razorpay-signature": signatureHeader }, body: body + " " }))).status, 400);
  assert.equal((await f.handlers.webhook(webhook("x".repeat(65537)))).status, 413);
  assert.equal((await f.handlers.webhook(webhook("{"))).status, 400);
  assert.equal(f.counts().applies, 0);
  assert.equal((await f.handlers.webhook(webhook(body))).status, 200); assert.equal(f.counts().applies, 1);
});
test("webhooks continue while the paywall is off and unknown events/orders are acknowledged", async () => {
  const f = fixture(); f.setEnabled(false);
  assert.equal((await f.handlers.webhook(webhook(JSON.stringify({ event: "unknown" })))).status, 200);
  const refund = JSON.stringify({ event: "refund.processed", payload: { refund: { entity: { payment_id: paymentId } } } });
  assert.equal((await f.handlers.webhook(webhook(refund))).status, 200);
  f.store.applyPayment = async () => null;
  assert.equal((await (await f.handlers.webhook(webhook(refund))).json()).ignored, true);
});
