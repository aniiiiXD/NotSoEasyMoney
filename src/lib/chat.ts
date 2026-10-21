import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb, lockProfiles, withTransaction } from "./db.ts";
import { recordRoomEventInTransaction } from "./analytics.ts";
import { isSampleForViewer } from "./demo.ts";

type RoomPair = { user_a: string; user_b: string };
type LockedRoom = RoomPair & { other_id: string };
type RoomRow = { id: string; alias: string; last_message_at: string | null };
type ReadRoomRow = {
  alias: string;
  id: string | null;
  body: string | null;
  mine: boolean | null;
  created_at: string | null;
};

export type RoomSummary = { id: string; alias: string; lastMessageAt: string | null };
export type ChatMessage = { id: string; body: string; mine: boolean; createdAt: string };

// Every read and write rechecks membership, both active profiles, and blocks
// in either direction. Parameter $1 is always the authenticated viewer.
const allowedRoom = `
  r.active = 1
  AND (r.user_a = $1 OR r.user_b = $1)
  AND me.active = 1 AND other.active = 1
  AND NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = r.user_a AND b.blocked_id = r.user_b)
       OR (b.blocker_id = r.user_b AND b.blocked_id = r.user_a)
  )
`;
const joinedProfiles = `
  JOIN profiles me ON me.user_id = $1
  JOIN profiles other ON other.user_id = CASE WHEN r.user_a = $1 THEN r.user_b ELSE r.user_a END
`;

/** Lock participants in the shared order, then recheck the room's access. */
async function lockAllowedRoom(client: PoolClient, userId: string, roomId: string): Promise<LockedRoom | null> {
  // Read only rooms the actor belongs to before acquiring any profile locks.
  const { rows: pairs } = await client.query<RoomPair>(
    "SELECT user_a, user_b FROM rooms WHERE id = $1 AND (user_a = $2 OR user_b = $2)",
    [roomId, userId],
  );
  const pair = pairs[0];
  if (!pair) return null;

  await lockProfiles(client, [pair.user_a, pair.user_b]);
  const { rows } = await client.query<LockedRoom>(`
    SELECT r.user_a, r.user_b, other.user_id AS other_id
    FROM rooms r ${joinedProfiles}
    WHERE r.id = $2 AND r.user_a = $3 AND r.user_b = $4 AND ${allowedRoom}
    FOR UPDATE OF r
  `, [userId, roomId, pair.user_a, pair.user_b]);
  return rows[0] ?? null;
}

export async function listRooms(userId: string): Promise<RoomSummary[]> {
  const { rows } = await getDb().query<RoomRow>(`
    SELECT r.id, other.alias, latest.last_message_at
    FROM rooms r ${joinedProfiles}
    LEFT JOIN LATERAL (
      SELECT max(m.created_at) AS last_message_at FROM messages m WHERE m.room_id = r.id
    ) latest ON true
    WHERE ${allowedRoom}
    ORDER BY COALESCE(latest.last_message_at, r.created_at) DESC, r.id
  `, [userId]);
  return rows.map((row) => ({ id: row.id, alias: row.alias, lastMessageAt: row.last_message_at }));
}

export async function readRoom(userId: string, roomId: string): Promise<{ alias: string; messages: ChatMessage[] } | null> {
  // Fetch room access and messages in one statement so both use the same
  // Postgres snapshot, including when a block is committed concurrently.
  const { rows } = await getDb().query<ReadRoomRow>(`
    SELECT other.alias, m.id, m.body,
      CASE WHEN m.id IS NOT NULL THEN m.sender_id = $1 ELSE NULL END AS mine,
      m.created_at
    FROM rooms r ${joinedProfiles}
    LEFT JOIN LATERAL (
      SELECT id, sender_id, body, created_at FROM messages
      WHERE room_id = r.id ORDER BY created_at DESC, id DESC LIMIT 100
    ) m ON true
    WHERE r.id = $2 AND ${allowedRoom}
    ORDER BY m.created_at ASC NULLS FIRST, m.id ASC NULLS FIRST
  `, [userId, roomId]);
  if (rows.length === 0) return null;
  const messages = rows.flatMap((row) =>
    row.id !== null && row.body !== null && row.created_at !== null
      ? [{ id: row.id, body: row.body, mine: row.mine === true, createdAt: row.created_at }]
      : [],
  );
  return { alias: rows[0].alias, messages };
}

export type SendMessageResult =
  | { ok: true; message: ChatMessage; sampleReply?: ChatMessage }
  | { ok: false; reason: "not_found" | "invalid" | "rate_limited" };

const SAMPLE_REPLIES = [
  "Demo reply: Hi! What does a really good weekend look like for you?",
  "Demo reply: I like that. What is something you could talk about for hours?",
  "Demo reply: Thanks for sharing. What is a small thing that made you smile lately?",
];

export async function sendMessage(userId: string, roomId: string, input: unknown): Promise<SendMessageResult> {
  if (typeof input !== "string") return { ok: false, reason: "invalid" };
  const body = input.trim();
  if (!body || body.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    return { ok: false, reason: "invalid" };
  }
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return { ok: false, reason: "not_found" };

    // The actor's profile lock also serializes sends across different rooms.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { rows: recent } = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM messages WHERE sender_id = $1 AND created_at >= $2",
      [userId, since],
    );
    if (Number(recent[0].count) >= 30) return { ok: false, reason: "rate_limited" };

    const id = randomUUID();
    const isSample = isSampleForViewer(userId, room.other_id);
    // Preserve sample-reply order even when multiple writes share a millisecond.
    const lastMessage = isSample
      ? (await client.query<{ time: string | null }>("SELECT max(created_at) AS time FROM messages WHERE room_id = $1", [roomId])).rows[0]
      : null;
    const lastTime = lastMessage?.time ? Date.parse(lastMessage.time) : 0;
    const timestamp = isSample && Number.isFinite(lastTime) ? Math.max(Date.now(), lastTime + 1) : Date.now();
    const createdAt = new Date(timestamp).toISOString();
    await client.query(
      "INSERT INTO messages (id, room_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, roomId, userId, body, createdAt],
    );
    let sampleReply: ChatMessage | undefined;
    if (isSample) {
      const { rows: count } = await client.query<{ count: string }>(
        "SELECT count(*) AS count FROM messages WHERE room_id = $1 AND sender_id = $2",
        [roomId, room.other_id],
      );
      sampleReply = { id: randomUUID(), body: SAMPLE_REPLIES[Number(count[0].count) % SAMPLE_REPLIES.length], mine: false, createdAt: new Date(timestamp + 1).toISOString() };
      await client.query(
        "INSERT INTO messages (id, room_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)",
        [sampleReply.id, roomId, room.other_id, sampleReply.body, sampleReply.createdAt],
      );
    }
    // The helper uses a savepoint: optional analytics failure cannot undo the
    // message, and consent is checked while both profile locks are still held.
    await recordRoomEventInTransaction(client, userId, roomId, "message_sent");
    return { ok: true, message: { id, body, mine: true, createdAt }, ...(sampleReply ? { sampleReply } : {}) };
  });
}

/** Block the other member and close the room in a single transaction. */
export async function blockRoom(userId: string, roomId: string): Promise<boolean> {
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return false;
    await client.query(
      "INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING",
      [userId, room.other_id],
    );
    await client.query("UPDATE rooms SET active = 0 WHERE id = $1", [roomId]);
    return true;
  });
}

export const REPORT_REASONS = ["harassment", "sexual_content", "scam", "underage", "other"] as const;
export type ReportReason = typeof REPORT_REASONS[number];

/** Report a conversation and block its other member in the same transaction. */
export async function reportRoom(userId: string, roomId: string, reason: unknown): Promise<"reported" | "invalid" | "not_found"> {
  if (typeof reason !== "string" || !REPORT_REASONS.includes(reason as ReportReason)) return "invalid";
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return "not_found";
    if (isSampleForViewer(userId, room.other_id)) return "not_found";
    await client.query(
      "INSERT INTO safety_reports (id, reporter_id, reported_id, room_id, reason) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (reporter_id, room_id) DO NOTHING",
      [randomUUID(), userId, room.other_id, roomId, reason],
    );
    await client.query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, room.other_id]);
    await client.query("UPDATE rooms SET active = 0 WHERE id = $1", [roomId]);
    return "reported";
  });
}
