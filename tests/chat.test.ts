import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb } from "../src/lib/db.ts";
import { blockRoom, listRooms, readRoom, sendMessage } from "../src/lib/chat.ts";
import { sampleId } from "../src/lib/demo.ts";

// These tests reset tables. Fail before opening a connection unless the caller
// explicitly provides a disposable test database, never the application DB.
const connectionString = process.env.DATABASE_URL;
let databaseName = "";
try {
  if (connectionString) databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
} catch { /* Invalid configuration is rejected below. */ }
if (!/^mm_test_[a-z0-9_]+$/i.test(databaseName)) {
  throw new Error("Chat integration tests require a disposable mm_test_ database in DATABASE_URL.");
}

const db = getDb();

async function addProfile(userId: string, alias: string, analyticsConsent = 0) {
  await db.query(`INSERT INTO profiles
    (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
    VALUES ($1, $2, 25, 'unspecified', '[]', 18, 50, '{}', '{}', 'test', $3)`,
  [userId, alias, analyticsConsent]);
}

async function addRoom(roomId: string, firstUserId: string, secondUserId: string) {
  const [userA, userB] = [firstUserId, secondUserId].sort();
  await db.query("INSERT INTO rooms (id, user_a, user_b) VALUES ($1, $2, $3)", [roomId, userA, userB]);
}

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
  await addProfile("local:alice", "Alice");
  await addProfile("local:bob", "Bob");
  await addProfile("local:eve", "Eve");
  await addRoom("room-1", "local:alice", "local:bob");
});

after(async () => { await db.end(); });

test("only active members can list, read, or send to a conversation", async () => {
  assert.deepEqual(await listRooms("local:eve"), []);
  assert.equal(await readRoom("local:eve", "room-1"), null);
  assert.deepEqual(await sendMessage("local:eve", "room-1", "hello"), { ok: false, reason: "not_found" });
  const aliceRooms = await listRooms("local:alice");
  assert.equal(aliceRooms[0].alias, "Bob");
  assert.deepEqual(Object.keys(aliceRooms[0]).sort(), ["alias", "id", "lastMessageAt"]);
  assert.equal((await listRooms("local:bob"))[0].alias, "Alice");
  assert.deepEqual(await readRoom("local:alice", "room-1"), { alias: "Bob", messages: [] });
  const sent = await sendMessage("local:alice", "room-1", "  Hello, Bob.  ");
  assert.equal(sent.ok, true);
  assert.deepEqual((await readRoom("local:bob", "room-1"))?.messages.map(({ body, mine }) => ({ body, mine })), [
    { body: "Hello, Bob.", mine: false },
  ]);
  assert.deepEqual((await readRoom("local:alice", "room-1"))?.messages.map(({ mine }) => mine), [true]);
});

test("a block in either direction denies both parties", async () => {
  for (const [blocker, blocked] of [["local:alice", "local:bob"], ["local:bob", "local:alice"]]) {
    await db.query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)", [blocker, blocked]);
    for (const userId of ["local:alice", "local:bob"]) {
      assert.deepEqual(await listRooms(userId), []);
      assert.equal(await readRoom(userId, "room-1"), null);
      assert.deepEqual(await sendMessage(userId, "room-1", "hello"), { ok: false, reason: "not_found" });
    }
    await db.query("DELETE FROM blocks");
  }
});

test("blocking a room requires membership and closes it for both members", async () => {
  assert.equal(await blockRoom("local:eve", "room-1"), false);
  assert.equal(await blockRoom("local:alice", "room-1"), true);
  assert.equal(await readRoom("local:alice", "room-1"), null);
  assert.equal(await readRoom("local:bob", "room-1"), null);
  const { rows } = await db.query("SELECT blocker_id, blocked_id FROM blocks");
  assert.deepEqual(rows, [{ blocker_id: "local:alice", blocked_id: "local:bob" }]);
});

test("deactivated rooms or profiles deny access", async () => {
  await db.query("UPDATE rooms SET active = 0 WHERE id = $1", ["room-1"]);
  assert.equal(await readRoom("local:alice", "room-1"), null);
  await db.query("UPDATE rooms SET active = 1 WHERE id = $1", ["room-1"]);
  await db.query("UPDATE profiles SET active = 0 WHERE user_id = $1", ["local:bob"]);
  assert.equal(await readRoom("local:alice", "room-1"), null);
  assert.deepEqual(await sendMessage("local:bob", "room-1", "hello"), { ok: false, reason: "not_found" });
});

test("message validation applies on the server", async () => {
  for (const input of ["", "   ", "x".repeat(2001), "hello\u0000", 42]) {
    assert.deepEqual(await sendMessage("local:alice", "room-1", input), { ok: false, reason: "invalid" });
  }
});

test("concurrent sends across rooms obey the per-sender limit", async () => {
  await addRoom("room-2", "local:alice", "local:eve");
  await db.query(`INSERT INTO messages (id, room_id, sender_id, body, created_at)
    SELECT 'seed-' || n, 'room-1', 'local:alice', 'seed', $1
    FROM generate_series(1, 29) AS n`, [new Date().toISOString()]);
  const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    sendMessage("local:alice", index % 2 === 0 ? "room-1" : "room-2", `message ${index}`),
  ));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.reason === "rate_limited").length, 5);
  const count = await db.query<{ count: string }>("SELECT count(*) AS count FROM messages WHERE sender_id = $1", ["local:alice"]);
  assert.equal(Number(count.rows[0].count), 30);
  assert.equal((await sendMessage("local:bob", "room-1", "reply")).ok, true);
});

test("a concurrent send and block serialize, and no messages are accepted after blocking", async () => {
  const [message, blocked] = await Promise.all([
    sendMessage("local:alice", "room-1", "A message racing the block"),
    blockRoom("local:bob", "room-1"),
  ]);
  assert.equal(blocked, true);
  assert.ok(message.ok || message.reason === "not_found");
  assert.equal(await readRoom("local:alice", "room-1"), null);
  assert.equal(await readRoom("local:bob", "room-1"), null);
  assert.deepEqual(await sendMessage("local:alice", "room-1", "after block"), { ok: false, reason: "not_found" });
  const stored = await db.query<{ count: string }>("SELECT count(*) AS count FROM messages WHERE room_id = $1", ["room-1"]);
  assert.equal(Number(stored.rows[0].count), message.ok ? 1 : 0);
});

test("a room returns the latest 100 messages in chronological order", async () => {
  await db.query(`INSERT INTO messages (id, room_id, sender_id, body, created_at)
    SELECT 'msg-' || lpad(n::text, 3, '0'), 'room-1', 'local:alice', 'message ' || n,
      to_char((timestamptz '2026-01-01 00:00:00+00' + n * interval '1 second') AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    FROM generate_series(1, 105) AS n`);
  const room = await readRoom("local:bob", "room-1");
  assert.ok(room);
  assert.equal(room.messages.length, 100);
  assert.equal(room.messages[0].body, "message 6");
  assert.equal(room.messages[99].body, "message 105");
  assert.ok(room.messages.every((message) => !message.mine));
});

test("message analytics needs both people's consent and cannot break a send", async () => {
  await db.query("UPDATE profiles SET analytics_consent = 1 WHERE user_id = $1", ["local:alice"]);
  assert.equal((await sendMessage("local:alice", "room-1", "One person consented")).ok, true);
  assert.equal((await db.query("SELECT 1 FROM analytics_events")).rowCount, 0);
  await db.query("UPDATE profiles SET analytics_consent = 1 WHERE user_id = $1", ["local:bob"]);
  assert.equal((await sendMessage("local:alice", "room-1", "Both consented")).ok, true);
  assert.equal((await sendMessage("local:alice", "room-1", "Still both consented")).ok, true);
  assert.equal((await db.query("SELECT 1 FROM analytics_events WHERE event_name = 'message_sent'")).rowCount, 1);

  // Missing analytics storage causes a SQL error. The helper's savepoint must
  // recover the transaction and allow the already-written message to commit.
  await db.query("ALTER TABLE analytics_events RENAME TO chat_test_hidden_analytics_events");
  try {
    const result = await sendMessage("local:alice", "room-1", "Analytics is unavailable");
    assert.equal(result.ok, true);
    assert.equal((await db.query("SELECT 1 FROM messages WHERE body = $1", ["Analytics is unavailable"])).rowCount, 1);
  } finally {
    await db.query("ALTER TABLE chat_test_hidden_analytics_events RENAME TO analytics_events");
  }
});

test("a sample room returns its scripted reply without recording analytics", async () => {
  const demoId = `demo:${randomUUID()}`;
  const otherId = sampleId(demoId, "sage");
  await addProfile(demoId, "Demo", 1);
  await addProfile(otherId, "Sage", 1);
  await addRoom("sample-room", demoId, otherId);
  const sent = await sendMessage(demoId, "sample-room", "Hello");
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.sampleReply?.body.startsWith("Demo reply:"));
  assert.deepEqual((await readRoom(demoId, "sample-room"))?.messages.map((message) => message.mine), [true, false]);
  assert.equal((await db.query("SELECT 1 FROM analytics_events")).rowCount, 0);
});
