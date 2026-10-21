import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../src/lib/db.ts";
import { blockRoom, listRooms, readRoom, sendMessage } from "../src/lib/chat.ts";

process.env.SQLITE_PATH = ":memory:";

beforeEach(() => {
  const db = getDb();
  db.exec("DELETE FROM profiles; DELETE FROM analytics_events; DELETE FROM local_test_accounts;");
  const insert = db.prepare(`INSERT INTO profiles
    (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version)
    VALUES (?, ?, 25, 'unspecified', '[]', 18, 50, '{}', '{}', 'test')`);
  insert.run("local:alice", "Alice");
  insert.run("local:bob", "Bob");
  insert.run("local:eve", "Eve");
  db.prepare("INSERT INTO rooms (id, user_a, user_b) VALUES (?, ?, ?)").run("room-1", "local:alice", "local:bob");
});

test("only active members can list, read, or send to a conversation", () => {
  assert.deepEqual(listRooms("local:eve"), []);
  assert.equal(readRoom("local:eve", "room-1"), null);
  assert.deepEqual(sendMessage("local:eve", "room-1", "hello"), { ok: false, reason: "not_found" });
  assert.equal(listRooms("local:alice")[0].alias, "Bob");
  assert.equal(listRooms("local:bob")[0].alias, "Alice");
  const sent = sendMessage("local:alice", "room-1", "  Hello, Bob.  ");
  assert.equal(sent.ok, true);
  assert.deepEqual(readRoom("local:bob", "room-1")?.messages.map(({ body, mine }) => ({ body, mine })), [
    { body: "Hello, Bob.", mine: false },
  ]);
  assert.deepEqual(readRoom("local:alice", "room-1")?.messages.map(({ mine }) => mine), [true]);
});

test("a block in either direction immediately denies both parties", () => {
  const db = getDb();
  db.prepare("INSERT INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run("local:bob", "local:alice");
  for (const userId of ["local:alice", "local:bob"]) {
    assert.deepEqual(listRooms(userId), []);
    assert.equal(readRoom(userId, "room-1"), null);
    assert.deepEqual(sendMessage(userId, "room-1", "hello"), { ok: false, reason: "not_found" });
  }
});

test("blocking a room requires membership and closes it for both members", () => {
  assert.equal(blockRoom("local:eve", "room-1"), false);
  assert.equal(blockRoom("local:alice", "room-1"), true);
  assert.equal(readRoom("local:alice", "room-1"), null);
  assert.equal(readRoom("local:bob", "room-1"), null);
  const block = getDb().prepare("SELECT blocker_id, blocked_id FROM blocks").get();
  assert.deepEqual({ ...block }, { blocker_id: "local:alice", blocked_id: "local:bob" });
});

test("deactivated rooms or profiles deny access", () => {
  const db = getDb();
  db.prepare("UPDATE rooms SET active = 0 WHERE id = ?").run("room-1");
  assert.equal(readRoom("local:alice", "room-1"), null);
  db.prepare("UPDATE rooms SET active = 1 WHERE id = ?").run("room-1");
  db.prepare("UPDATE profiles SET active = 0 WHERE user_id = ?").run("local:bob");
  assert.equal(readRoom("local:alice", "room-1"), null);
  assert.deepEqual(sendMessage("local:bob", "room-1", "hello"), { ok: false, reason: "not_found" });
});

test("message validation and per-sender rate limit apply on the server", () => {
  for (const input of ["", "   ", "x".repeat(2001), "hello\u0000", 42]) {
    assert.deepEqual(sendMessage("local:alice", "room-1", input), { ok: false, reason: "invalid" });
  }
  for (let i = 0; i < 30; i++) assert.equal(sendMessage("local:alice", "room-1", `message ${i}`).ok, true);
  assert.deepEqual(sendMessage("local:alice", "room-1", "one too many"), { ok: false, reason: "rate_limited" });
  assert.equal(sendMessage("local:bob", "room-1", "reply").ok, true);
});
