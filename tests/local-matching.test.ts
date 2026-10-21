import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../src/lib/db.ts";
import { decideCandidate, listCandidates, parseProfileInput, saveProfile } from "../src/lib/local-matching.ts";
import { recordMatchEvent, setAnalyticsConsent } from "../src/lib/analytics.ts";

process.env.SQLITE_PATH = ":memory:";
const db = getDb();
const answers = { social_setting: 2, planning_style: 3, novelty: 4, conversation_style: 2, message_frequency: 3, date_atmosphere: null };
const profile = { alias: "Moonbeam", age: 29, gender: "woman", seeking: ["man"], minAge: 18, maxAge: 45, answers, analyticsConsent: false };

function reset() {
  db.exec("DELETE FROM messages; DELETE FROM rooms; DELETE FROM candidate_tokens; DELETE FROM decisions; DELETE FROM blocks; DELETE FROM analytics_events; DELETE FROM profiles;");
}

test("validates the complete adult profile without guessing missing answers", () => {
  assert.equal(parseProfileInput(profile).answers.date_atmosphere, null);
  assert.throws(() => parseProfileInput({ ...profile, age: 17 }), /18/);
  assert.throws(() => parseProfileInput({ ...profile, seeking: [] }), /meet/);
  assert.throws(() => parseProfileInput({ ...profile, minAge: 40, maxAge: 20 }), /age range/);
  assert.throws(() => parseProfileInput({ ...profile, answers: { ...answers, social_setting: null, planning_style: null, novelty: null } }), /at least three/);
});

test("creates a blind room only after two eligible people opt in", () => {
  reset();
  saveProfile(db, "google:private-a", profile);
  saveProfile(db, "google:private-b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] });
  const first = listCandidates(db, "google:private-a")!;
  assert.equal(first.length, 1);
  assert.equal(first[0].blindAlias, "Sundial");
  assert(!JSON.stringify(first).includes("google:private-b"));
  assert(!JSON.stringify(first).includes("vector"));
  const second = listCandidates(db, "google:private-b")!;
  assert.equal(decideCandidate(db, "google:private-a", first[0].candidateId, "like"), "pending");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rooms").get()?.count, 0);
  assert.equal(decideCandidate(db, "google:private-b", first[0].candidateId, "like"), "unavailable");
  assert.equal(second.length, 1);
  assert.equal(decideCandidate(db, "google:private-b", second[0].candidateId, "like"), "matched");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM rooms").get()?.count, 1);
  assert.equal(decideCandidate(db, "google:private-b", second[0].candidateId, "like"), "unavailable");
  assert.deepEqual(listCandidates(db, "google:private-a"), []);
});

test("blocks and passes revoke an otherwise eligible introduction", () => {
  reset();
  saveProfile(db, "a", profile);
  saveProfile(db, "b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] });
  const token = listCandidates(db, "a")![0].candidateId;
  db.prepare("INSERT INTO blocks(blocker_id, blocked_id) VALUES (?, ?)").run("b", "a");
  assert.equal(decideCandidate(db, "a", token, "like"), "unavailable");
  assert.deepEqual(listCandidates(db, "a"), []);
  db.exec("DELETE FROM blocks");
  const newToken = listCandidates(db, "a")![0].candidateId;
  assert.equal(decideCandidate(db, "a", newToken, "pass"), "passed");
  assert.deepEqual(listCandidates(db, "b"), []);
});

test("editing invalidates invitations and a stale edit cannot undo a consent withdrawal", () => {
  reset();
  saveProfile(db, "a", { ...profile, analyticsConsent: true });
  saveProfile(db, "b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"] });
  const token = listCandidates(db, "a")![0].candidateId;
  db.prepare("INSERT INTO analytics_events(user_id,event_name,occurred_at) VALUES (?, ?, ?)").run("a", "profile_saved", new Date().toISOString());
  assert.equal(setAnalyticsConsent("a", false), true);
  saveProfile(db, "a", { ...profile, analyticsConsent: true });
  assert.equal(decideCandidate(db, "a", token, "like"), "unavailable");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE user_id = ?").get("a")?.count, 0);
  assert.equal(db.prepare("SELECT analytics_consent FROM profiles WHERE user_id = ?").get("a")?.analytics_consent, 0);
});

test("new matches record pair analytics only with consent, and withdrawal removes them", () => {
  reset();
  saveProfile(db, "a", { ...profile, analyticsConsent: true });
  saveProfile(db, "b", { ...profile, alias: "Sundial", gender: "man", seeking: ["woman"], analyticsConsent: true });
  const first = listCandidates(db, "a")![0];
  const second = listCandidates(db, "b")![0];
  assert.equal(decideCandidate(db, "a", first.candidateId, "like"), "pending");
  assert.equal(decideCandidate(db, "b", second.candidateId, "like", (roomId, a, b) => {
    recordMatchEvent(a, roomId);
    recordMatchEvent(b, roomId);
  }), "matched");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'").get()?.count, 2);
  saveProfile(db, "c", { ...profile, alias: "Dawn" });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'").get()?.count, 2);
  assert.equal(setAnalyticsConsent("a", false), true);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM analytics_events WHERE event_name = 'match_created'").get()?.count, 0);
});
