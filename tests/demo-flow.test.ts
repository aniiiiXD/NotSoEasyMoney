import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { blockRoom, listRooms, readRoom, sendMessage } from "../src/lib/chat.ts";
import { getDb } from "../src/lib/db.ts";
import { GENDERS, decideCandidate, listCandidates, saveProfile } from "../src/lib/local-matching.ts";
import { sampleId } from "../src/lib/demo.ts";

process.env.SQLITE_PATH = ":memory:";
const db = getDb();
const demoA = "demo:11111111-1111-4111-8111-111111111111";
const demoB = "demo:22222222-2222-4222-8222-222222222222";
const answers = { social_setting: null, planning_style: null, novelty: null, conversation_style: 1, message_frequency: 3, date_atmosphere: 5 };
const profile = { alias: "Moonbeam", age: 29, gender: "woman", seeking: ["man"], minAge: 18, maxAge: 45, answers, analyticsConsent: false };

beforeEach(() => {
  db.exec("DELETE FROM profiles; DELETE FROM analytics_events; DELETE FROM local_test_accounts;");
});

test("sample introductions work for every allowed gender and a single-age preference", () => {
  for (const gender of GENDERS) {
    for (const seeking of GENDERS) {
      saveProfile(db, demoA, { ...profile, age: 18, gender, seeking: [seeking], minAge: 120, maxAge: 120 });
      const candidates = listCandidates(db, demoA)!;
      assert.equal(candidates.length, 3);
      assert(candidates.every((candidate) => candidate.blindAlias.includes("(sample)")));
      assert(candidates.every((candidate) => candidate.explanation.includes("sample")));
      assert(!JSON.stringify(candidates).includes(demoA));
    }
  }
});

test("real accounts, other demo sessions, and sample identities never share a pool", () => {
  saveProfile(db, demoA, profile);
  saveProfile(db, demoB, profile);
  saveProfile(db, "google:real-a", profile);
  saveProfile(db, "google:real-b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] });

  assert.deepEqual(listCandidates(db, "google:real-a")?.map((candidate) => candidate.blindAlias), ["Sundial"]);
  assert.deepEqual(listCandidates(db, sampleId(demoA, "sage")), []);
  assert.equal(listCandidates(db, demoA)?.length, 3);
  assert.equal(listCandidates(db, demoB)?.length, 3);
  const tokens = db.prepare("SELECT target_id FROM candidate_tokens WHERE viewer_id = ?").all(demoA) as { target_id: string }[];
  assert(tokens.every(({ target_id }) => target_id.startsWith(`sample:${demoA}:`)));

  // A stale or forged token must still be checked against the same isolation
  // rules at decision time, not only when introductions are listed.
  const expires = Date.now() + 60_000;
  db.prepare("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES (?, ?, ?, ?)")
    .run("forged-other-session", demoA, sampleId(demoB, "sage"), expires);
  db.prepare("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES (?, ?, ?, ?)")
    .run("forged-real-to-sample", "google:real-a", sampleId(demoA, "sage"), expires);
  db.prepare("INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES (?, ?, ?, ?)")
    .run("forged-demo-to-real", demoA, "google:real-b", expires);
  for (const [viewer, token] of [[demoA, "forged-other-session"], ["google:real-a", "forged-real-to-sample"], [demoA, "forged-demo-to-real"]]) {
    assert.equal(decideCandidate(db, viewer, token, "like"), "unavailable");
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM rooms").get()?.count, 0);
});

test("a demo hello creates a mutual room with scripted replies, then blocking closes it", () => {
  saveProfile(db, demoA, profile);
  saveProfile(db, demoB, profile);
  const candidate = listCandidates(db, demoA)![0];
  assert.equal(decideCandidate(db, demoA, candidate.candidateId, "like"), "matched");
  assert.equal(db.prepare("SELECT count(*) AS count FROM decisions WHERE decision = 'like'").get()?.count, 2);
  const room = listRooms(demoA)[0];
  assert(room.alias.includes("(sample)"));
  assert.deepEqual(listRooms(demoB), []);
  assert.equal(readRoom(demoB, room.id), null);
  assert.deepEqual(sendMessage(demoB, room.id, "hello"), { ok: false, reason: "not_found" });

  const first = sendMessage(demoA, room.id, "Hello there");
  assert(first.ok);
  assert.equal(first.message.mine, true);
  assert.equal(first.sampleReply?.mine, false);
  assert.match(first.sampleReply!.body, /^Demo reply:/);
  const second = sendMessage(demoA, room.id, "What about you?");
  assert(second.ok);
  assert.notEqual(first.sampleReply?.body, second.sampleReply?.body);
  assert.deepEqual(readRoom(demoA, room.id)?.messages.map(({ mine }) => mine), [true, false, true, false]);

  assert.equal(blockRoom(demoA, room.id), true);
  assert.equal(readRoom(demoA, room.id), null);
  assert.deepEqual(sendMessage(demoA, room.id, "Another hello"), { ok: false, reason: "not_found" });
  assert.deepEqual(listRooms(demoA), []);
  saveProfile(db, demoA, { ...profile, age: 40, gender: "another identity", seeking: ["nonbinary"], minAge: 60, maxAge: 70 });
  assert.equal(listCandidates(db, demoA)?.length, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM blocks").get()?.count, 1);
  assert.equal(db.prepare("SELECT active FROM rooms WHERE id = ?").get(room.id)?.active, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM decisions WHERE decision = 'like'").get()?.count, 2);
});
