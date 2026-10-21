import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { getDb, lockProfiles } from "../src/lib/db.ts";
import { decideCandidate, getOwnProfile, listCandidates, parseProfileInput, saveProfile } from "../src/lib/local-matching.ts";
import { setAnalyticsConsent } from "../src/lib/analytics.ts";
import { answersInOrder } from "../src/lib/personality.ts";

let db: Pool | undefined;
const answers = answersInOrder([2, 3, 4, 2, 3, ...Array(15).fill(null)]);
const profile = { alias: "Moonbeam", age: 29, gender: "woman", seeking: ["man"], minAge: 18, maxAge: 45, answers, analyticsConsent: false };
const otherProfile = { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] };

function database(): Pool {
  if (!db) throw new Error("The test database has not been initialized.");
  return db;
}

test.before(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must point to a dedicated mm_test_ database.");
  db = getDb();
  const result = await db.query<{ name: string }>("SELECT current_database() AS name");
  if (!result.rows[0]?.name.startsWith("mm_test_")) throw new Error("Refusing to run: database name must start with mm_test_.");
});

test.after(async () => {
  if (db) await db.end();
});

async function reset() {
  // Check the actual server-side database name on the same connection before
  // any destructive reset, not just the possibly misleading URL text.
  const client = await database().connect();
  try {
    const result = await client.query<{ name: string }>("SELECT current_database() AS name");
    if (!result.rows[0]?.name.startsWith("mm_test_")) throw new Error("Refusing to reset a non-test database.");
    await client.query(`TRUNCATE TABLE safety_reports, messages, rooms, candidate_tokens, decisions, blocks,
      analytics_events, profiles, referral_attributions, referral_codes, app_users`);
  } finally {
    client.release();
  }
}

async function count(sql: string, values: string[] = []): Promise<number> {
  const result = await database().query<{ count: number }>(sql, values);
  return Number(result.rows[0].count);
}

test("validates the complete adult profile without guessing missing answers", () => {
  assert.equal(parseProfileInput(profile).answers.sailboat, null);
  assert.throws(() => parseProfileInput({ ...profile, age: 17 }), /18/);
  assert.throws(() => parseProfileInput({ ...profile, seeking: [] }), /meet/);
  assert.throws(() => parseProfileInput({ ...profile, minAge: 40, maxAge: 20 }), /age range/);
  assert.throws(() => parseProfileInput({ ...profile, answers: { ...answers, life_of_party: null, talk_at_parties: null, dont_talk_much: null } }), /at least three/);
});

test("creates a blind room only after two eligible people opt in", async () => {
  await reset();
  await database().query("INSERT INTO app_users (user_id) VALUES ('google:private-a'), ('google:private-b')");
  await saveProfile(database(), "google:private-a", profile);
  await saveProfile(database(), "google:private-b", otherProfile);
  const first = (await listCandidates(database(), "google:private-a"))!;
  assert.equal(first.length, 1);
  assert.equal(first[0].blindAlias, "Sundial");
  assert(!JSON.stringify(first).includes("google:private-b"));
  assert(!JSON.stringify(first).includes("vector"));
  assert(!JSON.stringify(first).includes("life_of_party"));
  assert(!JSON.stringify(first).includes("score"));
  const second = (await listCandidates(database(), "google:private-b"))!;
  assert.equal(await decideCandidate(database(), "google:private-a", first[0].candidateId, "like"), "pending");
  assert.equal(await count("SELECT COUNT(*) AS count FROM rooms"), 0);
  assert.equal(await decideCandidate(database(), "google:private-b", first[0].candidateId, "like"), "unavailable");
  assert.equal(second.length, 1);
  let callbackSawCommittedRoom = false;
  assert.equal(await decideCandidate(database(), "google:private-b", second[0].candidateId, "like", async (roomId) => {
    callbackSawCommittedRoom = await count("SELECT COUNT(*) AS count FROM rooms WHERE id = $1", [roomId]) === 1;
  }), "matched");
  assert.equal(callbackSawCommittedRoom, true);
  assert.equal(await count("SELECT COUNT(*) AS count FROM rooms"), 1);
  assert.equal(await decideCandidate(database(), "google:private-b", second[0].candidateId, "like"), "unavailable");
  assert.deepEqual(await listCandidates(database(), "google:private-a"), []);
});

test("blocks and passes revoke an otherwise eligible introduction", async () => {
  await reset();
  await saveProfile(database(), "a", profile);
  await saveProfile(database(), "b", otherProfile);
  const token = (await listCandidates(database(), "a"))![0].candidateId;
  await database().query("INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2)", ["b", "a"]);
  assert.equal(await decideCandidate(database(), "a", token, "like"), "unavailable");
  assert.deepEqual(await listCandidates(database(), "a"), []);
  await database().query("DELETE FROM blocks");
  const newToken = (await listCandidates(database(), "a"))![0].candidateId;
  assert.equal(await decideCandidate(database(), "a", newToken, "pass"), "passed");
  assert.deepEqual(await listCandidates(database(), "b"), []);
});

test("editing invalidates invitations and a stale edit cannot undo a consent withdrawal", async () => {
  await reset();
  await saveProfile(database(), "a", { ...profile, analyticsConsent: true });
  await saveProfile(database(), "b", otherProfile);
  const token = (await listCandidates(database(), "a"))![0].candidateId;
  assert((await count("SELECT COUNT(*) AS count FROM analytics_events WHERE user_id = $1", ["a"])) > 0);
  assert.equal(await setAnalyticsConsent("a", false), true);
  await saveProfile(database(), "a", { ...profile, analyticsConsent: true });
  assert.equal(await decideCandidate(database(), "a", token, "like"), "unavailable");
  assert.equal(await count("SELECT COUNT(*) AS count FROM analytics_events WHERE user_id = $1", ["a"]), 0);
  assert.equal((await getOwnProfile(database(), "a"))?.analyticsConsent, false);
});

test("new matches record pair analytics only with consent, and withdrawal removes them", async () => {
  await reset();
  await saveProfile(database(), "a", { ...profile, analyticsConsent: true });
  await saveProfile(database(), "b", { ...otherProfile, analyticsConsent: true });
  const first = (await listCandidates(database(), "a"))![0];
  const second = (await listCandidates(database(), "b"))![0];
  assert.equal(await decideCandidate(database(), "a", first.candidateId, "like"), "pending");
  assert.equal(await decideCandidate(database(), "b", second.candidateId, "like"), "matched");
  assert.equal(await count("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'"), 2);
  await saveProfile(database(), "c", { ...profile, alias: "Dawn" });
  assert.equal(await count("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'"), 2);
  assert.equal(await setAnalyticsConsent("a", false), true);
  assert.equal(await count("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'"), 0);
});

test("simultaneous reciprocal likes produce one room and two decisions", async () => {
  await reset();
  await saveProfile(database(), "a", profile);
  await saveProfile(database(), "b", otherProfile);
  const [a, b] = await Promise.all([listCandidates(database(), "a"), listCandidates(database(), "b")]);
  const results = await Promise.all([
    decideCandidate(database(), "a", a![0].candidateId, "like"),
    decideCandidate(database(), "b", b![0].candidateId, "like"),
  ]);
  assert.deepEqual(results.sort(), ["matched", "pending"]);
  assert.equal(await count("SELECT COUNT(*) AS count FROM rooms"), 1);
  assert.equal(await count("SELECT COUNT(*) AS count FROM decisions WHERE decision = 'like'"), 2);
});

test("parallel candidate requests preserve the same live opaque token", async () => {
  await reset();
  await saveProfile(database(), "a", profile);
  await saveProfile(database(), "b", otherProfile);
  const results = await Promise.all(Array.from({ length: 5 }, () => listCandidates(database(), "a")));
  assert(results.every((candidates) => candidates?.length === 1));
  assert.equal(new Set(results.map((candidates) => candidates![0].candidateId)).size, 1);
});

test("candidate issuance rechecks a block that commits while it is waiting for profile locks", async () => {
  await reset();
  await saveProfile(database(), "a", profile);
  await saveProfile(database(), "b", otherProfile);
  const locker = await database().connect();
  let committed = false;
  let pending: ReturnType<typeof listCandidates> | undefined;
  try {
    await locker.query("BEGIN");
    await lockProfiles(locker, ["a", "b"]);
    pending = listCandidates(database(), "a");
    // Attach a rejection handler immediately in case a failure occurs while
    // the controlling connection still holds the locks.
    pending.catch(() => {});
    let waiting = false;
    for (let attempt = 0; attempt < 30 && !waiting; attempt += 1) {
      const check = await database().query<{ waiting: boolean }>(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
          AND wait_event_type = 'Lock' AND query LIKE 'SELECT user_id FROM profiles WHERE user_id = ANY%'
      ) AS waiting`);
      waiting = check.rows[0].waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(waiting, "candidate issuance should wait on the profile locks");
    await locker.query("INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2)", ["b", "a"]);
    await locker.query("COMMIT");
    committed = true;
  } finally {
    if (!committed) await locker.query("ROLLBACK");
    locker.release();
  }
  assert.deepEqual(await pending, []);
  assert.equal(await count("SELECT COUNT(*) AS count FROM candidate_tokens"), 0);
});

test("room ordering follows the database's C collation for Unicode user IDs", async () => {
  await reset();
  const firstId = "\uE000";
  const secondId = "\u{10000}";
  await saveProfile(database(), firstId, profile);
  await saveProfile(database(), secondId, otherProfile);
  const a = (await listCandidates(database(), firstId))![0];
  const b = (await listCandidates(database(), secondId))![0];
  assert.equal(await decideCandidate(database(), firstId, a.candidateId, "like"), "pending");
  assert.equal(await decideCandidate(database(), secondId, b.candidateId, "like"), "matched");
  const room = await database().query<{ user_a: string; user_b: string }>("SELECT user_a, user_b FROM rooms");
  assert.deepEqual(room.rows[0], { user_a: firstId, user_b: secondId });
});

test("profile completion marks a referral once and profile edits do not overwrite it", async () => {
  await reset();
  await database().query("INSERT INTO app_users(user_id) VALUES ($1)", ["a"]);
  await database().query("INSERT INTO referral_codes(code, label) VALUES ($1, $2)", ["FRIEND", "Friends"]);
  await database().query("INSERT INTO referral_attributions(user_id, code) VALUES ($1, $2)", ["a", "FRIEND"]);
  assert.deepEqual(await saveProfile(database(), "a", profile), { created: true });
  const initial = await database().query<{ profile_completed_at: Date | null }>("SELECT profile_completed_at FROM referral_attributions WHERE user_id = $1", ["a"]);
  assert(initial.rows[0].profile_completed_at instanceof Date);
  assert.deepEqual(await saveProfile(database(), "a", { ...profile, alias: "Daylight" }), { created: false });
  const afterEdit = await database().query<{ profile_completed_at: Date | null }>("SELECT profile_completed_at FROM referral_attributions WHERE user_id = $1", ["a"]);
  assert.equal(afterEdit.rows[0].profile_completed_at?.getTime(), initial.rows[0].profile_completed_at?.getTime());
});
