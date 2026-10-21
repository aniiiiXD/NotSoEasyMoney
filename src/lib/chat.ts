import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import type { DatabaseSync } from "node:sqlite";
import { isSampleForViewer } from "./demo.ts";

type RoomRow = { id: string; alias: string; other_id: string; last_message_at: string | null };
type MessageRow = { id: string; sender_id: string; body: string; created_at: string };

export type RoomSummary = { id: string; alias: string; lastMessageAt: string | null };
export type ChatMessage = { id: string; body: string; mine: boolean; createdAt: string };

// This predicate is repeated in reads so an in-flight block cannot turn a
// preliminary room check into a later unrestricted message query.
const allowedRoom = `
  r.active = 1
  AND (r.user_a = $viewer OR r.user_b = $viewer)
  AND me.active = 1 AND other.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = r.user_a AND b.blocked_id = r.user_b)
       OR (b.blocker_id = r.user_b AND b.blocked_id = r.user_a)
  )
`;
const joinedProfiles = `
  JOIN profiles me ON me.user_id = $viewer
  JOIN profiles other ON other.user_id = CASE WHEN r.user_a = $viewer THEN r.user_b ELSE r.user_a END
`;

function findRoom(db: DatabaseSync, userId: string, roomId: string): RoomRow | undefined {
  return db.prepare(`
    SELECT r.id, other.alias, other.user_id AS other_id, NULL AS last_message_at FROM rooms r
    ${joinedProfiles}
    WHERE r.id = $room AND ${allowedRoom}
  `).get({ viewer: userId, room: roomId }) as RoomRow | undefined;
}

export function listRooms(userId: string): RoomSummary[] {
  const rows = getDb().prepare(`
    SELECT r.id, other.alias, other.user_id AS other_id,
      (SELECT max(m.created_at) FROM messages m WHERE m.room_id = r.id) AS last_message_at
    FROM rooms r ${joinedProfiles}
    WHERE ${allowedRoom}
    ORDER BY COALESCE(last_message_at, r.created_at) DESC, r.id
  `).all({ viewer: userId }) as RoomRow[];
  return rows.map((row) => ({ id: row.id, alias: row.alias, lastMessageAt: row.last_message_at }));
}

export function readRoom(userId: string, roomId: string): { alias: string; messages: ChatMessage[] } | null {
  const db = getDb();
  const room = findRoom(db, userId, roomId);
  if (!room) return null;
  const rows = db.prepare(`
    SELECT m.id, m.sender_id, m.body, m.created_at
    FROM messages m JOIN rooms r ON r.id = m.room_id ${joinedProfiles}
    WHERE r.id = $room AND ${allowedRoom}
    ORDER BY m.created_at DESC, m.id DESC LIMIT 100
  `).all({ viewer: userId, room: roomId }) as MessageRow[];
  return { alias: room.alias, messages: rows.reverse().map((row) => ({
    id: row.id, body: row.body, mine: row.sender_id === userId, createdAt: row.created_at,
  })) };
}

export type SendMessageResult =
  | { ok: true; message: ChatMessage; sampleReply?: ChatMessage }
  | { ok: false; reason: "not_found" | "invalid" | "rate_limited" };

const SAMPLE_REPLIES = [
  "Demo reply: Hi! What does a really good weekend look like for you?",
  "Demo reply: I like that. What is something you could talk about for hours?",
  "Demo reply: Thanks for sharing. What is a small thing that made you smile lately?",
];

export function sendMessage(userId: string, roomId: string, input: unknown): SendMessageResult {
  if (typeof input !== "string") return { ok: false, reason: "invalid" };
  const body = input.trim();
  if (!body || body.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    return { ok: false, reason: "invalid" };
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const room = findRoom(db, userId, roomId);
    if (!room) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = db.prepare("SELECT count(*) AS count FROM messages WHERE sender_id = ? AND created_at >= ?")
      .get(userId, since) as { count: number };
    if (recent.count >= 30) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "rate_limited" };
    }
    const id = randomUUID();
    const isSample = isSampleForViewer(userId, room.other_id);
    // Preserve the order of a sample's instant reply and a subsequent message,
    // even when several writes fall within the same millisecond.
    const lastMessage = isSample ? db.prepare("SELECT max(created_at) AS time FROM messages WHERE room_id = ?").get(roomId) as { time: string | null } : null;
    const lastTime = lastMessage?.time ? Date.parse(lastMessage.time) : 0;
    const timestamp = isSample && Number.isFinite(lastTime) ? Math.max(Date.now(), lastTime + 1) : Date.now();
    const createdAt = new Date(timestamp).toISOString();
    db.prepare("INSERT INTO messages (id, room_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, roomId, userId, body, createdAt);
    let sampleReply: ChatMessage | undefined;
    if (isSample) {
      const count = db.prepare("SELECT count(*) AS count FROM messages WHERE room_id = ? AND sender_id = ?")
        .get(roomId, room.other_id) as { count: number };
      sampleReply = { id: randomUUID(), body: SAMPLE_REPLIES[count.count % SAMPLE_REPLIES.length], mine: false, createdAt: new Date(timestamp + 1).toISOString() };
      db.prepare("INSERT INTO messages (id, room_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(sampleReply.id, roomId, room.other_id, sampleReply.body, sampleReply.createdAt);
    }
    db.exec("COMMIT");
    return { ok: true, message: { id, body, mine: true, createdAt }, ...(sampleReply ? { sampleReply } : {}) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Block the other member and close the room in a single transaction. */
export function blockRoom(userId: string, roomId: string): boolean {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!findRoom(db, userId, roomId)) {
      db.exec("ROLLBACK");
      return false;
    }
    const room = db.prepare("SELECT user_a, user_b FROM rooms WHERE id = ?").get(roomId) as { user_a: string; user_b: string };
    const other = room.user_a === userId ? room.user_b : room.user_a;
    db.prepare("INSERT OR IGNORE INTO blocks (blocker_id, blocked_id) VALUES (?, ?)").run(userId, other);
    db.prepare("UPDATE rooms SET active = 0 WHERE id = ?").run(roomId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
