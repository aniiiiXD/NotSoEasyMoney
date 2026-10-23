import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db.ts";
import { getActiveReferral, listReferralSummaries, normalizeReferralCode, recordReferralClick, REFERRAL_MAX_AGE, referralUrl, registerGoogleAccount, signReferralCode, verifyReferralCode } from "../src/lib/referrals.ts";

const databaseUrl = process.env.DATABASE_URL;
let databaseName = "";
try { if (databaseUrl) databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1)); } catch { /* rejected below */ }
if (!/^mm_test_[a-z0-9_]+$/i.test(databaseName)) throw new Error("Referral integration tests require a disposable mm_test_ database in DATABASE_URL.");
const db = getDb();
after(async () => { await db.end(); });

test("referral cookies reject modification, expiration, invalid values and the wrong secret", () => {
  const time = Date.now();
  const cookie = signReferralCode("creator_1", "unit-test-secret", time);
  assert.equal(verifyReferralCode(cookie, "unit-test-secret", time), "CREATOR_1");
  assert.equal(verifyReferralCode(cookie.replace("CREATOR_1", "CREATOR_2"), "unit-test-secret", time), null);
  assert.equal(verifyReferralCode(cookie, "wrong-secret", time), null);
  assert.equal(verifyReferralCode(cookie, "unit-test-secret", time + REFERRAL_MAX_AGE * 1000), null);
  assert.equal(verifyReferralCode("x", "unit-test-secret", time), null);
  assert.equal(normalizeReferralCode("../../../bad"), null);
});

test("referral URLs always use a configured first-party origin", () => {
  const prior = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://mystery-match.example";
    assert.equal(referralUrl("creator1"), "https://mystery-match.example/r/CREATOR1");
    process.env.APP_URL = "http://evil.example";
    assert.throws(() => referralUrl("creator1"));
    process.env.APP_URL = "https://mystery-match.example/path";
    assert.throws(() => referralUrl("creator1"));
  } finally {
    if (prior === undefined) delete process.env.APP_URL; else process.env.APP_URL = prior;
  }
});

test("only a new Google account can claim an active referral, even concurrently", async () => {
  const id = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const a = `A${id}`;
  const b = `B${id}`;
  const users = ["new", "existing", "disabled", "race"].map((suffix) => `google:test-${id}-${suffix}`);
  try {
    await db.query("INSERT INTO referral_codes (code, label, active) VALUES ($1, 'Creator A', true), ($2, 'Creator B', true)", [a, b]);
    assert.equal((await getActiveReferral(db, a))?.label, "Creator A");
    assert.equal(await registerGoogleAccount(db, users[0], a), true);
    assert.equal(await registerGoogleAccount(db, users[0], b), false);
    assert.equal(await registerGoogleAccount(db, users[1], null), true);
    assert.equal(await registerGoogleAccount(db, users[1], a), false);
    await db.query("UPDATE referral_codes SET active = false WHERE code = $1", [b]);
    assert.equal(await getActiveReferral(db, b), null);
    assert.equal(await registerGoogleAccount(db, users[2], b), true);
    await db.query("UPDATE referral_codes SET active = true WHERE code = $1", [b]);
    const results = await Promise.all([registerGoogleAccount(db, users[3], a), registerGoogleAccount(db, users[3], b)]);
    assert.deepEqual(results.sort(), [false, true]);
    const { rows } = await db.query<{ user_id: string; code: string }>("SELECT user_id, code FROM referral_attributions WHERE user_id = ANY($1::text[]) ORDER BY user_id", [users]);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((row) => row.user_id === users[0])?.code, a);
    assert.ok([a, b].includes(rows.find((row) => row.user_id === users[3])!.code));
  } finally {
    await db.query("DELETE FROM app_users WHERE user_id = ANY($1::text[])", [users]);
    await db.query("DELETE FROM referral_codes WHERE code = ANY($1::text[])", [[a, b]]);
  }
});

test("invitation clicks, signups and captured payments are counted per code", async () => {
  const id = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const code = `C${id}`;
  const userId = `google:test-${id}-payer`;
  try {
    await db.query("INSERT INTO referral_codes (code, label) VALUES ($1, 'Creator C')", [code]);
    let summary = (await listReferralSummaries(db)).find((item) => item.code === code)!;
    assert.equal(summary.clicks, 0);
    assert.equal(summary.payments, 0);
    await recordReferralClick(db, code);
    await recordReferralClick(db, code);
    await db.query("INSERT INTO app_users (user_id) VALUES ($1)", [userId]);
    await db.query("INSERT INTO referral_attributions (user_id, code) VALUES ($1, $2)", [userId, code]);
    // One member, two captured payments and one refunded payment.
    const orderIds = [1, 2, 3].map(() => `order_${randomUUID().replaceAll("-", "")}`);
    const statuses = ["paid", "paid", "refunded"];
    for (const [index, orderId] of orderIds.entries()) {
      await db.query(
        "INSERT INTO payment_orders (order_id, user_id, receipt, key_id, mode, amount, currency, status) VALUES ($1, $2, $3, 'rzp_test_disposable', 'test', 2000, 'INR', $4)",
        [orderId, userId, `receipt_${orderId}`, statuses[index]]);
    }
    summary = (await listReferralSummaries(db)).find((item) => item.code === code)!;
    assert.equal(summary.clicks, 2);
    assert.equal(summary.signups, 1, "multiple payments must not inflate signups");
    assert.equal(summary.payments, 2, "only captured payments count");
    assert.equal(summary.profiles, 0);
    await db.query("UPDATE payment_orders SET status = 'refunded' WHERE order_id = $1", [orderIds[0]]);
    summary = (await listReferralSummaries(db)).find((item) => item.code === code)!;
    assert.equal(summary.payments, 1, "refunds drop out of the payment count");
  } finally {
    await db.query("DELETE FROM app_users WHERE user_id = $1", [userId]);
    await db.query("DELETE FROM referral_codes WHERE code = $1", [code]);
  }
});
