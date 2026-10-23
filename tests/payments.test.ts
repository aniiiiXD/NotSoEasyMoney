import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPaymentStore, type GatewayPayment } from "../src/lib/payment-store.ts";
import { saveProfile, listCandidates, decideCandidate, getOwnProfile } from "../src/lib/local-matching.ts";
import { emptyAnswers } from "../src/lib/personality.ts";
import { deleteAccount } from "../src/lib/account.ts";

const connection = process.env.DATABASE_URL;
if (!connection || !/^mm_test_[a-z0-9_]+$/i.test(new URL(connection).pathname.slice(1))) throw new Error("Payment integration tests require an isolated mm_test_ database.");
const db = new pg.Pool({ connectionString: connection });
const store = createPaymentStore(() => db);
const users: string[] = [];
after(async () => { await db.query("DELETE FROM profiles WHERE user_id = ANY($1::text[])", [users]); await db.query("DELETE FROM app_users WHERE user_id = ANY($1::text[])", [users]); await db.end(); });
async function account(complete = true, gender: "man" | "woman" = "man") {
  const userId = `google:billing-${randomUUID()}`; users.push(userId);
  await db.query("INSERT INTO app_users (user_id) VALUES ($1)", [userId]);
  if (complete) {
    const answers = emptyAnswers(); for (const key of Object.keys(answers).slice(0, 3) as (keyof typeof answers)[]) answers[key] = 3;
    await saveProfile(db, userId, { alias: "Moonbeam", age: 25, gender, seeking: [gender === "man" ? "woman" : "man"], minAge: 18, maxAge: 99, answers, analyticsConsent: false });
  }
  return userId;
}
function item() { return { keyId: "rzp_test_disposable", mode: "test" as const, amount: 2000, currency: "INR" }; }
function create() { return async () => ({ id: `order_${randomUUID().replaceAll("-", "")}`, amount: 2000, currency: "INR" }); }
function payment(orderId: string): GatewayPayment { return { id: `pay_${randomUUID().replaceAll("-", "")}`, order_id: orderId, amount: 2000, currency: "INR", status: "captured", captured: true, amount_refunded: 0 }; }

test("concurrent checkouts reuse one provider order; incomplete profiles cannot pay", async () => {
  const user = await account(); let calls = 0; const creator = create();
  const results = await Promise.all([1, 2, 3].map(() => store.createOrder(user, item(), async () => { calls++; return creator(); })));
  assert.equal(calls, 1); assert.equal(new Set(results.map(r => r?.order_id)).size, 1);
  await assert.rejects(store.createOrder(await account(false), item(), create()), /Finish your profile/);
});
test("capture grants only the order owner and test access never grants live access", async () => {
  const user = await account(); const other = await account(); const order = (await store.createOrder(user, item(), create()))!;
  assert.equal(await store.hasAccess(user, "test"), false); assert.equal(await store.getOrder(order.order_id, other), null);
  await store.applyPayment(payment(order.order_id), "test");
  assert.equal(await store.hasAccess(user, "test"), true); assert.equal(await store.hasAccess(other, "test"), false); assert.equal(await store.hasAccess(user, "live"), false);
  assert.equal(await store.createOrder(user, item(), async () => { throw new Error("Must not charge twice"); }), null);
});
test("authorized/failed/wrong amount/currency/mode do not grant access", async () => {
  const user = await account(); const order = (await store.createOrder(user, item(), create()))!; const paid = payment(order.order_id);
  await store.applyPayment({ ...paid, status: "authorized", captured: false }, "test"); assert.equal(await store.hasAccess(user, "test"), false);
  await store.applyPayment({ ...paid, status: "failed", captured: false }, "test"); assert.equal(await store.hasAccess(user, "test"), false);
  for (const override of [{ amount: 100 }, { currency: "USD" }]) await assert.rejects(store.applyPayment({ ...paid, ...override }, "test"), /do not match/);
  await assert.rejects(store.applyPayment(paid, "live"), /do not match/);
  assert.equal(await store.hasAccess(user, "test"), false);
});
test("duplicates and out-of-order events cannot undo capture or re-grant refunded access", async () => {
  const user = await account(); const order = (await store.createOrder(user, item(), create()))!; const paid = payment(order.order_id);
  await Promise.all([store.applyPayment(paid, "test"), store.applyPayment(paid, "test")]);
  await store.applyPayment({ ...paid, status: "authorized", captured: false }, "test");
  await store.applyPayment({ ...paid, status: "failed", captured: false }, "test");
  assert.equal(await store.hasAccess(user, "test"), true);
  await store.applyPayment({ ...paid, amount_refunded: 1 }, "test");
  await store.applyPayment(paid, "test");
  assert.equal(await store.hasAccess(user, "test"), false); assert.equal((await store.getOrder(order.order_id))?.status, "refunded");
});
test("account deletion removes orders/access; late notifications cannot resurrect them", async () => {
  const user = await account(); const order = (await store.createOrder(user, item(), create()))!; const paid = payment(order.order_id);
  await store.applyPayment(paid, "test"); await deleteAccount(db, user);
  assert.equal(await store.getOrder(order.order_id), null); assert.equal(await store.hasAccess(user, "test"), false);
  assert.equal(await store.applyPayment(paid, "test"), null);
  await assert.rejects(store.createOrder(user, item(), create()), /Sign in again/);
});

test("one payment reveals exactly one person; concurrent retries and profile edits never spend twice", async () => {
  const viewer = await account(); await account(true, "woman"); await account(true, "woman");
  const order = (await store.createOrder(viewer, item(), create()))!;
  await store.applyPayment(payment(order.order_id), "test");
  assert.deepEqual(await listCandidates(db, viewer, { mode: "test" }), []);
  assert.equal(await store.hasAccess(viewer, "test"), true, "GET does not consume credit");
  const [first, retry] = await Promise.all([1, 2].map(() => listCandidates(db, viewer, { mode: "test", reveal: true })));
  assert.equal(first?.length, 1); assert.deepEqual(retry, first);
  assert.equal(await store.hasAccess(viewer, "test"), false);
  assert.equal((await db.query("SELECT * FROM paid_introductions WHERE viewer_id=$1", [viewer])).rowCount, 1);
  await saveProfile(db, viewer, { ...(await getOwnProfile(db, viewer))!, alias: "New nickname" });
  const refreshed = await listCandidates(db, viewer, { mode: "test" }); assert.equal(refreshed?.length, 1);
  const all = (await listCandidates(db, viewer))!;
  const locked = all.find(candidate => candidate.candidateId !== refreshed![0].candidateId)!;
  await assert.rejects(decideCandidate(db, viewer, locked.candidateId, "like", undefined, "test"), /not been unlocked/);
  assert.equal(await decideCandidate(db, viewer, refreshed![0].candidateId, "pass", undefined, "test"), "passed");
  await assert.rejects(listCandidates(db, viewer, { mode: "test", reveal: true }), /Pay for one new/);
  const second = (await store.createOrder(viewer, item(), create()))!; assert.ok(second);
  await store.applyPayment(payment(second.order_id), "test");
  assert.equal((await listCandidates(db, viewer, { mode: "test", reveal: true }))?.length, 1);
  assert.equal((await db.query("SELECT * FROM paid_introductions WHERE viewer_id=$1", [viewer])).rowCount, 2);
});

test("an empty pool preserves credit; refunds hide an unlock and deleting the target never restores a spent credit", async () => {
  const viewer = await account();
  const own = (await getOwnProfile(db, viewer))!;
  await saveProfile(db, viewer, { ...own, minAge: 119, maxAge: 120 });
  const order = (await store.createOrder(viewer, item(), create()))!; const paid = payment(order.order_id);
  await store.applyPayment(paid, "test");
  assert.deepEqual(await listCandidates(db, viewer, { mode: "test", reveal: true }), []);
  assert.equal(await store.hasAccess(viewer, "test"), true);
  const target = await account(true, "woman");
  const targetProfile = (await getOwnProfile(db, target))!;
  await saveProfile(db, target, { ...targetProfile, age: 119 });
  assert.equal((await listCandidates(db, viewer, { mode: "test", reveal: true }))?.length, 1);
  await store.applyPayment({ ...paid, status: "refunded", amount_refunded: 2000 }, "test");
  assert.deepEqual(await listCandidates(db, viewer, { mode: "test" }), []);
  await deleteAccount(db, target);
  assert.equal((await db.query("SELECT target_id FROM paid_introductions WHERE order_id=$1", [order.order_id])).rows[0].target_id, null);
  assert.equal(await store.hasAccess(viewer, "test"), false);
});
