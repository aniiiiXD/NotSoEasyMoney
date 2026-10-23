// Local, isolated mm_test_ database only. --setup prepares browser onboarding;
// --verify checks the real test payment and simulates a signed webhook retry.
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import pg from "pg";
import { encode } from "next-auth/jwt";
import { emptyAnswers } from "../src/lib/personality.ts";

const origin = process.env.APP_URL;
const connection = process.env.DATABASE_URL;
if (!origin || !connection || !/^mm_test_[a-z0-9_]+$/i.test(new URL(connection).pathname.slice(1)) || !["127.0.0.1", "localhost"].includes(new URL(origin).hostname) || !process.env.RAZORPAY_KEY_ID?.startsWith("rzp_test_")) throw new Error("Billing E2E requires local app, isolated mm_test_ database, and Razorpay test keys.");
const db = new pg.Pool({ connectionString: connection });
const file = ".local/billing-browser-context.json";
const salt = "authjs.session-token";
async function call(path, cookie, body) {
  return fetch(origin + path, { redirect: "manual", method: body === undefined ? "GET" : "POST", headers: { origin, ...(cookie ? { cookie: `${salt}=${cookie}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function session(userId) {
  const row = (await db.query("INSERT INTO app_users (user_id) VALUES ($1) RETURNING session_version", [userId])).rows[0];
  return encode({ secret: process.env.AUTH_SECRET, salt, token: { userId, accountVersion: row.session_version } });
}
try {
  assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name, new URL(connection).pathname.slice(1));
  if (process.argv.includes("--setup")) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const userId = `google:billing-browser-${suffix}`;
    const otherId = `google:billing-other-${suffix}`;
    const cookie = await session(userId); const otherCookie = await session(otherId);
    const answers = emptyAnswers(); Object.keys(answers).slice(0, 3).forEach(key => { answers[key] = 3; });
    const profile = await call("/api/profile", otherCookie, { alias: "Sunbeam", age: 26, gender: "man", seeking: ["woman"], minAge: 18, maxAge: 99, answers, analyticsConsent: false });
    assert.equal(profile.status, 200); assert.equal((await profile.json()).nextUrl, "/checkout");
    for (const path of ["/api/create-order", "/api/verify-payment", "/api/payments/status"]) assert.equal((await call(path, null, {})).status, 401);
    assert.deepEqual((await (await call("/api/candidates", otherCookie)).json()).candidates, []);
    assert.equal((await call("/api/candidates", otherCookie, { candidateId: "fake", decision: "like" })).status, 404);
    assert.equal((await call("/discover", otherCookie)).status, 200);
    assert.equal((await call("/api/create-order", otherCookie, { amount: 100 })).status, 400);
    const orderResponse = await call("/api/create-order", otherCookie, {}); assert.equal(orderResponse.status, 200);
    const order = await orderResponse.json(); assert.equal(order.amount, Number(process.env.DISCOVERY_PRICE_PAISE));
    const retry = await call("/api/create-order", otherCookie, {}); assert.equal((await retry.json()).order_id, order.order_id);
    assert.equal((await call("/api/verify-payment", cookie, { razorpay_order_id: order.order_id, razorpay_payment_id: "pay_wrong", razorpay_signature: "0".repeat(64) })).status, 404);
    await mkdir(".local", { recursive: true });
    await writeFile(file, JSON.stringify({ origin, userId, otherId, cookie, otherCookie, cookieName: salt }), { mode: 0o600 });
    console.log("PASS authenticated paywall, profile-to-checkout handoff, direct URL/API protection, price tampering, order reuse and cross-account ownership.");
    console.log("Browser onboarding session prepared in ignored local context file.");
  } else if (process.argv.includes("--verify")) {
    const context = JSON.parse(await readFile(file, "utf8"));
    const order = (await db.query("SELECT * FROM payment_orders WHERE user_id = $1 AND status = 'paid' ORDER BY created_at DESC LIMIT 1", [context.userId])).rows[0];
    assert.ok(order?.payment_id, "Complete the Razorpay test payment in the browser first.");
    assert.equal((await call("/api/candidates", context.cookie)).status, 200);
    assert.equal((await call("/discover", context.cookie)).status, 200);
    assert.deepEqual((await (await call("/api/candidates", context.otherCookie)).json()).candidates, []);
    // Simulate loss of browser confirmation, in this disposable database only.
    await db.query("UPDATE payment_orders SET status = 'created', payment_id = NULL WHERE order_id = $1", [order.order_id]);
    assert.deepEqual((await (await call("/api/candidates", context.cookie)).json()).candidates, []);
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: order.payment_id } } } });
    const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
    const webhook = async value => fetch(origin + "/api/payments/razorpay/webhook", { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": value }, body });
    assert.equal((await webhook("0".repeat(64))).status, 400);
    assert.deepEqual((await (await call("/api/candidates", context.cookie)).json()).candidates, []);
    for (let retry = 0; retry < 2; retry++) assert.equal((await webhook(signature)).status, 200);
    assert.equal((await call("/api/candidates", context.cookie)).status, 200);
    assert.deepEqual((await (await call("/api/candidates", context.otherCookie)).json()).candidates, []);
    assert.equal((await db.query("SELECT status FROM payment_orders WHERE order_id=$1", [order.order_id])).rows[0].status, "paid");
    console.log(`PASS real Razorpay test payment ${order.payment_id}: account access persists and other accounts stay locked.`);
    console.log("PASS signed webhook replay (simulated delivery, real provider re-fetch), duplicate handling, and invalid signature rejection.");
  } else throw new Error("Use --setup or --verify.");
} finally { await db.end(); }
