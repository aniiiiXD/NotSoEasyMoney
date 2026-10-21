// Run only against a migrated, disposable mm_test_ database and a local app
// started with the same DATABASE_URL, APP_URL and AUTH_SECRET.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { encode } from "next-auth/jwt";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { getDb } from "../src/lib/db.ts";
import { registerGoogleAccount, verifyReferralCode } from "../src/lib/referrals.ts";

const connection = process.env.DATABASE_URL;
const origin = process.env.APP_URL;
const secret = process.env.AUTH_SECRET;
if (!connection || !origin || !secret) throw new Error("DATABASE_URL, APP_URL and AUTH_SECRET are required.");
const dbName = decodeURIComponent(new URL(connection).pathname.slice(1));
const appUrl = new URL(origin);
if (!/^mm_test_[a-z0-9_]+$/i.test(dbName) || appUrl.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(appUrl.hostname)) throw new Error("E2E requires an mm_test_ database and a local HTTP app.");
const db = getDb();
const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
const code = `E2E${suffix}`;
const secondCode = `ALT${suffix}`;
const dashboardCode = `DASH${suffix}`;
const users = [`google:e2e-${suffix}-alice`, `google:e2e-${suffix}-bob`];
const aliases = [`A${suffix.slice(0, 6)}`, `B${suffix.slice(0, 6)}`];
let verifiedTestDatabase = false;
async function request(path, options = {}) { return fetch(new URL(path, origin), { redirect: "manual", ...options }); }
async function session(userId) {
  const salt = "authjs.session-token";
  return `${salt}=${await encode({ secret, salt, token: { userId } })}`;
}
async function json(path, cookie, method = "GET", body) {
  const response = await request(path, { method, headers: { cookie, origin, ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
try {
  const actualDatabase = (await db.query("SELECT current_database() AS name")).rows[0].name;
  assert.equal(actualDatabase, dbName);
  verifiedTestDatabase = true;
  const created = spawnSync(process.execPath, ["scripts/referrals.mjs", "create", code, "Test creator"], { env: process.env, encoding: "utf8" });
  assert.equal(created.status, 0, "Referral CLI must create the code");
  assert.match(created.stdout, new RegExp(`/r/${code}/qr`));
  await db.query("INSERT INTO referral_codes (code, label) VALUES ($1, 'Other creator')", [secondCode]);

  const admin = await session("google:e2e-admin");
  const outsider = await session("google:e2e-outsider");
  assert.equal((await request("/api/admin/referrals")).status, 401);
  assert.equal((await request("/api/admin/referrals", { headers: { cookie: outsider } })).status, 403);
  assert.equal((await request("/admin/referrals", { headers: { cookie: outsider } })).status, 404);
  assert.equal((await request("/api/admin/referrals", { method: "POST", headers: { cookie: admin, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ code: dashboardCode, label: "Test" }) })).status, 403);
  const dashboard = await request("/admin/referrals", { headers: { cookie: admin } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Influencer links/);
  assert.ok((await json("/api/admin/referrals", admin, "POST", { code: dashboardCode.toLowerCase(), label: "Dashboard creator" })).referrals.some((item) => item.code === dashboardCode && item.active));
  assert.equal((await request("/api/admin/referrals", { method: "POST", headers: { cookie: admin, origin, "content-type": "application/json" }, body: JSON.stringify({ code: dashboardCode, label: "Duplicate" }) })).status, 409);
  assert.equal((await request(`/r/${dashboardCode}/qr`)).status, 200);
  await json("/api/admin/referrals", admin, "PATCH", { code: dashboardCode, active: false });
  assert.equal((await request(`/r/${dashboardCode}/qr`)).status, 404);
  await json("/api/admin/referrals", admin, "PATCH", { code: dashboardCode, active: true });
  assert.equal((await request(`/r/${dashboardCode}/qr`)).status, 200);
  console.log("PASS private dashboard access, create, duplicate rejection, QR, disable and re-enable");

  const invite = await request(`/r/${code}`);
  assert.equal(invite.status, 307);
  const setCookie = invite.headers.getSetCookie().find((value) => value.startsWith("mystery-match-referral="));
  assert.ok(setCookie?.includes("HttpOnly") && setCookie.includes("SameSite=lax"));
  const cookie = setCookie.split(";", 1)[0];
  const encodedCode = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  assert.equal(verifyReferralCode(encodedCode, secret), code);
  const firstTouch = await request(`/r/${secondCode}`, { headers: { cookie } });
  assert.equal(firstTouch.status, 307);
  assert.equal(firstTouch.headers.getSetCookie().length, 0);
  const signInPage = await request("/sign-in", { headers: { cookie } });
  assert.match(await signInPage.text(), /Invited by.*Test creator/);
  const qrResponse = await request(`/r/${code}/qr`);
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get("content-type"), /^image\/png/);
  const png = PNG.sync.read(Buffer.from(await qrResponse.arrayBuffer()));
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(scanned?.data, `${origin}/r/${code}`);
  assert.equal((await request("/r/NOTEXIST/qr")).status, 404);
  console.log("PASS referral CLI, first-touch cookie, sign-in notice, and QR image decoded to the invitation URL");

  // Simulate the verified Google callback: real credentials are needed to test Google itself.
  assert.equal(await registerGoogleAccount(db, users[0], verifyReferralCode(encodedCode, secret)), true);
  assert.equal(await registerGoogleAccount(db, users[1], null), true);
  assert.equal(await registerGoogleAccount(db, users[0], secondCode), false);
  const alice = await session(users[0]);
  const bob = await session(users[1]);
  const answers = {
    life_of_party: 3, talk_at_parties: 4, dont_talk_much: 2, keep_in_background: 3, sympathize_feelings: 4,
    feel_emotions: 4, not_interested_in_others: 2, chores_right_away: 3, like_order: 4, forget_to_put_back: 3,
    make_a_mess: 2, mood_swings: 2, upset_easily: 2, relaxed: 4, seldom_blue: 4,
    vivid_imagination: 4, not_interested_abstract: 2, horror_movies: 2, travel_alone: 4, sailboat: 3,
  };
  const profile = (alias) => ({ alias, age: 26, gender: "nonbinary", seeking: ["nonbinary"], minAge: 18, maxAge: 40, answers, analyticsConsent: true });
  assert.equal((await request("/api/profile")).status, 401);
  assert.equal((await json("/api/profile", alice, "POST", profile(aliases[0]))).created, true);
  assert.equal((await json("/api/profile", bob, "POST", profile(aliases[1]))).created, true);
  assert.equal((await json("/api/profile", alice)).profile.alias, aliases[0]);
  const aliceCandidates = (await json("/api/candidates", alice)).candidates;
  const bobCandidates = (await json("/api/candidates", bob)).candidates;
  const aliceToken = aliceCandidates.find((candidate) => candidate.blindAlias === aliases[1])?.candidateId;
  const bobToken = bobCandidates.find((candidate) => candidate.blindAlias === aliases[0])?.candidateId;
  assert.ok(aliceToken && bobToken);
  assert.equal((await json("/api/candidates", alice, "POST", { candidateId: aliceToken, decision: "like" })).status, "pending");
  const match = await json("/api/candidates", bob, "POST", { candidateId: bobToken, decision: "like" });
  assert.equal(match.status, "matched");
  assert.ok(match.roomId);
  const sent = await json(`/api/rooms/${match.roomId}/messages`, alice, "POST", { body: "Hello from the integration test" });
  assert.equal(sent.message.body, "Hello from the integration test");
  const room = await json(`/api/rooms/${match.roomId}/messages`, bob);
  assert.equal(room.messages.at(-1).body, "Hello from the integration test");
  const deniedReport = await request(`/api/rooms/${match.roomId}/report`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ reason: "scam" }) });
  assert.equal(deniedReport.status, 401);
  const report = await request(`/api/rooms/${match.roomId}/report`, { method: "POST", headers: { cookie: alice, origin, "content-type": "application/json" }, body: JSON.stringify({ reason: "scam" }) });
  assert.equal(report.status, 204);
  assert.equal((await request(`/api/rooms/${match.roomId}/messages`, { headers: { cookie: bob } })).status, 404);
  const queued = await db.query("SELECT reason, status FROM safety_reports WHERE room_id = $1", [match.roomId]);
  assert.deepEqual(queued.rows, [{ reason: "scam", status: "open" }]);
  assert.equal((await json("/api/analytics/consent", alice)).enabled, true);
  assert.equal((await json("/api/analytics/consent", alice, "PUT", { enabled: false })).enabled, false);
  const attribution = (await db.query("SELECT code, profile_completed_at FROM referral_attributions WHERE user_id = $1", [users[0]])).rows[0];
  assert.equal(attribution.code, code);
  assert.ok(attribution.profile_completed_at);
  const summary = (await json("/api/admin/referrals", admin)).referrals.find((item) => item.code === code);
  assert.equal(summary.signups, 1);
  assert.equal(summary.profiles, 1);
  console.log("PASS dashboard signup and completed-profile counts");
  const listing = spawnSync(process.execPath, ["scripts/referrals.mjs", "list"], { env: process.env, encoding: "utf8" });
  assert.equal(listing.status, 0);
  assert.ok(listing.stdout.includes(code));
  const complete = await request("/signup/complete", { headers: { cookie } });
  assert.ok(complete.headers.getSetCookie().some((value) => value.includes("Max-Age=0")));
  console.log("PASS simulated Google account registration, referral attribution, profiles, mutual matching, chat, report and block, and analytics consent");
} finally {
  if (verifiedTestDatabase) {
    await db.query("DELETE FROM profiles WHERE user_id = ANY($1::text[])", [users]);
    await db.query("DELETE FROM analytics_events WHERE user_id = ANY($1::text[])", [users]);
    await db.query("DELETE FROM app_users WHERE user_id = ANY($1::text[])", [users]);
    await db.query("DELETE FROM referral_codes WHERE code = ANY($1::text[])", [[code, secondCode, dashboardCode]]);
  }
  await db.end();
}
