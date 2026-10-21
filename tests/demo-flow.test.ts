import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { blockRoom, listRooms, readRoom, sendMessage } from "../src/lib/chat.ts";
import { getDb } from "../src/lib/db.ts";
import { GENDERS, decideCandidate, listCandidates, saveProfile } from "../src/lib/local-matching.ts";
import { sampleId } from "../src/lib/demo.ts";
import { answersInOrder } from "../src/lib/personality.ts";

// These integration tests reset data. Refuse all URLs except those explicitly
// pointing to a disposable test database; verify the connected DB again below.
const connectionString = process.env.DATABASE_URL;
let databaseName = "";
try {
  if (connectionString) databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch { /* Invalid configuration is rejected below. */ }
if (!/^mm_test_[a-z0-9_]+$/i.test(databaseName)) {
  throw new Error("Demo integration tests require a disposable mm_test_ database in DATABASE_URL.");
}

const db = getDb();
const demoA = "demo:11111111-1111-4111-8111-111111111111";
const demoB = "demo:22222222-2222-4222-8222-222222222222";
const answers = answersInOrder([...Array(17).fill(null), 1, 3, 5]);
const profile = { alias: "Moonbeam", age: 29, gender: "woman", seeking: ["man"], minAge: 18, maxAge: 45, answers, analyticsConsent: false };

beforeEach(async () => {
  const client = await db.connect();
  try {
    const { rows } = await client.query<{ name: string }>("SELECT current_database() AS name");
    if (rows[0]?.name !== databaseName || !/^mm_test_[a-z0-9_]+$/i.test(rows[0]?.name)) {
      throw new Error("Refusing to reset a database that is not the configured mm_test_ database.");
    }
    await client.query("TRUNCATE profiles, analytics_events, local_test_accounts RESTART IDENTITY CASCADE");
  } finally {
    client.release();
  }
});

after(async () => { await db.end(); });

test("sample introductions work for every allowed gender and a single-age preference", async () => {
  const combinations = GENDERS.flatMap((gender) => GENDERS.map((seeking) => ({ gender, seeking })));
  // Each combination uses its own demo session and can safely run in parallel.
  const results = await Promise.allSettled(combinations.map(async ({ gender, seeking }) => {
    const demoId = `demo:${randomUUID()}`;
    await saveProfile(db, demoId, { ...profile, age: 18, gender, seeking: [seeking], minAge: 120, maxAge: 120 });
    const candidates = await listCandidates(db, demoId);
    assert.ok(candidates);
    assert.equal(candidates.length, 3);
    assert.ok(candidates.every((candidate) => candidate.blindAlias.includes("(sample)")));
    assert.ok(candidates.every((candidate) => candidate.explanation.includes("sample")));
    assert.ok(!JSON.stringify(candidates).includes(demoId));
  }));
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
});

test("real accounts, other demo sessions, and sample identities never share a pool", async () => {
  await saveProfile(db, demoA, profile);
  await saveProfile(db, demoB, profile);
  await saveProfile(db, "google:real-a", profile);
  await saveProfile(db, "google:real-b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] });

  assert.deepEqual((await listCandidates(db, "google:real-a"))?.map((candidate) => candidate.blindAlias), ["Sundial"]);
  assert.deepEqual(await listCandidates(db, sampleId(demoA, "sage")), []);
  assert.equal((await listCandidates(db, demoA))?.length, 3);
  assert.equal((await listCandidates(db, demoB))?.length, 3);
  const tokens = await db.query<{ target_id: string }>("SELECT target_id FROM candidate_tokens WHERE viewer_id = $1", [demoA]);
  assert.ok(tokens.rows.every(({ target_id }) => target_id.startsWith(`sample:${demoA}:`)));

  // A stale or forged token must still be checked against the same isolation
  // rules at decision time, not only when introductions are listed.
  const expires = Date.now() + 60_000;
  await db.query("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES ($1, $2, $3, $4)",
    ["forged-other-session", demoA, sampleId(demoB, "sage"), expires]);
  await db.query("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES ($1, $2, $3, $4)",
    ["forged-real-to-sample", "google:real-a", sampleId(demoA, "sage"), expires]);
  await db.query("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES ($1, $2, $3, $4)",
    ["forged-demo-to-real", demoA, "google:real-b", expires]);
  for (const [viewer, token] of [[demoA, "forged-other-session"], ["google:real-a", "forged-real-to-sample"], [demoA, "forged-demo-to-real"]]) {
    assert.equal(await decideCandidate(db, viewer, token, "like"), "unavailable");
  }
  const rooms = await db.query<{ count: string }>("SELECT count(*) AS count FROM rooms");
  assert.equal(Number(rooms.rows[0].count), 0);
});

test("a demo hello creates a mutual room with scripted replies, then blocking closes it", async () => {
  await saveProfile(db, demoA, profile);
  await saveProfile(db, demoB, profile);
  const candidates = await listCandidates(db, demoA);
  assert.ok(candidates);
  const candidate = candidates[0];
  assert.ok(candidate);
  let matchedRoomId: string | undefined;
  assert.equal(await decideCandidate(db, demoA, candidate.candidateId, "like", (roomId) => { matchedRoomId = roomId; }), "matched");
  const likes = await db.query<{ count: string }>("SELECT count(*) AS count FROM decisions WHERE decision = 'like'");
  assert.equal(Number(likes.rows[0].count), 2);
  const room = (await listRooms(demoA))[0];
  assert.equal(matchedRoomId, room.id);
  assert.ok(room.alias.includes("(sample)"));
  assert.deepEqual(await listRooms(demoB), []);
  assert.equal(await readRoom(demoB, room.id), null);
  assert.deepEqual(await sendMessage(demoB, room.id, "hello"), { ok: false, reason: "not_found" });

  const first = await sendMessage(demoA, room.id, "Hello there");
  assert.ok(first.ok);
  assert.equal(first.message.mine, true);
  assert.equal(first.sampleReply?.mine, false);
  assert.match(first.sampleReply!.body, /^Demo reply:/);
  const second = await sendMessage(demoA, room.id, "What about you?");
  assert.ok(second.ok);
  assert.notEqual(first.sampleReply?.body, second.sampleReply?.body);
  assert.deepEqual((await readRoom(demoA, room.id))?.messages.map(({ mine }) => mine), [true, false, true, false]);

  assert.equal(await blockRoom(demoA, room.id), true);
  assert.equal(await readRoom(demoA, room.id), null);
  assert.deepEqual(await sendMessage(demoA, room.id, "Another hello"), { ok: false, reason: "not_found" });
  assert.deepEqual(await listRooms(demoA), []);
  await saveProfile(db, demoA, { ...profile, age: 40, gender: "another identity", seeking: ["nonbinary"], minAge: 60, maxAge: 70 });
  assert.equal((await listCandidates(db, demoA))?.length, 2);
  const blocks = await db.query<{ count: string }>("SELECT count(*) AS count FROM blocks");
  assert.equal(Number(blocks.rows[0].count), 1);
  const storedRoom = await db.query<{ active: number }>("SELECT active FROM rooms WHERE id = $1", [room.id]);
  assert.equal(storedRoom.rows[0]?.active, 0);
  const storedLikes = await db.query<{ count: string }>("SELECT count(*) AS count FROM decisions WHERE decision = 'like'");
  assert.equal(Number(storedLikes.rows[0].count), 2);
});
