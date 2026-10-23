import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getDb, lockProfiles, withTransaction } from "./db.ts";
import { recordRoomEventInTransaction } from "./analytics.ts";
import { isReservedDemoIdentity } from "./demo.ts";

type RoomPair = { user_a: string; user_b: string };
type LockedRoom = RoomPair & { other_id: string; closed: boolean };
type RoomRow = { id: string; alias: string; last_message_at: string | null; closed: boolean };
type ReadRoomRow = {
  alias: string;
  closed: boolean;
  my_handle: string | null;
  their_ready: boolean;
  their_handle: string | null;
  id: string | null;
  body: string | null;
  mine: boolean | null;
  created_at: string | null;
};

export type RoomSummary = { id: string; alias: string; lastMessageAt: string | null; closed: boolean };
export type ChatMessage = { id: string; body: string; mine: boolean; createdAt: string };
/** The other member's handle is only present once both have shared and the room is closed. */
export type InstagramExchange = { mine: string | null; theirsReady: boolean; theirs: string | null; closed: boolean };

// Every read and write rechecks membership, both active profiles, and blocks
// in either direction. Parameter $1 is always the authenticated viewer.
const allowedRoom = `
  r.active = 1
  AND (r.user_a = $1 OR r.user_b = $1)
  AND substr(r.user_a, 1, 5) <> 'demo:' AND substr(r.user_a, 1, 7) <> 'sample:'
  AND substr(r.user_b, 1, 5) <> 'demo:' AND substr(r.user_b, 1, 7) <> 'sample:'
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
    SELECT r.user_a, r.user_b, other.user_id AS other_id, r.closed_at IS NOT NULL AS closed
    FROM rooms r ${joinedProfiles}
    WHERE r.id = $2 AND r.user_a = $3 AND r.user_b = $4 AND ${allowedRoom}
    FOR UPDATE OF r
  `, [userId, roomId, pair.user_a, pair.user_b]);
  return rows[0] ?? null;
}

export async function listRooms(userId: string): Promise<RoomSummary[]> {
  const { rows } = await getDb().query<RoomRow>(`
    SELECT r.id, other.alias, latest.last_message_at, r.closed_at IS NOT NULL AS closed
    FROM rooms r ${joinedProfiles}
    LEFT JOIN LATERAL (
      SELECT max(m.created_at) AS last_message_at FROM messages m WHERE m.room_id = r.id
    ) latest ON true
    WHERE ${allowedRoom}
    ORDER BY COALESCE(latest.last_message_at, r.created_at) DESC, r.id
  `, [userId]);
  return rows.map((row) => ({ id: row.id, alias: row.alias, lastMessageAt: row.last_message_at, closed: row.closed }));
}

export async function readRoom(userId: string, roomId: string): Promise<{ alias: string; messages: ChatMessage[]; instagram: InstagramExchange } | null> {
  // Fetch room access, the Instagram exchange and messages in one statement so
  // all use the same Postgres snapshot, including when a block is committed concurrently.
  const { rows } = await getDb().query<ReadRoomRow>(`
    SELECT other.alias, r.closed_at IS NOT NULL AS closed,
      (SELECT s.handle FROM instagram_shares s WHERE s.room_id = r.id AND s.user_id = $1) AS my_handle,
      EXISTS (SELECT 1 FROM instagram_shares s WHERE s.room_id = r.id AND s.user_id = other.user_id) AS their_ready,
      (SELECT s.handle FROM instagram_shares s WHERE s.room_id = r.id AND s.user_id = other.user_id AND r.closed_at IS NOT NULL) AS their_handle,
      m.id, m.body,
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
  const first = rows[0];
  return {
    alias: first.alias,
    messages,
    instagram: { mine: first.my_handle, theirsReady: first.their_ready, theirs: first.their_handle, closed: first.closed },
  };
}

export type SendMessageResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; reason: "not_found" | "invalid" | "rate_limited" | "closed" };

export async function sendMessage(userId: string, roomId: string, input: unknown): Promise<SendMessageResult> {
  if (typeof input !== "string") return { ok: false, reason: "invalid" };
  const body = input.trim();
  if (!body || body.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)) {
    return { ok: false, reason: "invalid" };
  }
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return { ok: false, reason: "not_found" };
    if (room.closed) return { ok: false, reason: "closed" };

    // The actor's profile lock also serializes sends across different rooms.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { rows: recent } = await client.query<{ count: string }>(
      "SELECT count(*) AS count FROM messages WHERE sender_id = $1 AND created_at >= $2",
      [userId, since],
    );
    if (Number(recent[0].count) >= 30) return { ok: false, reason: "rate_limited" };

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await client.query(
      "INSERT INTO messages (id, room_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, roomId, userId, body, createdAt],
    );
    // The helper uses a savepoint: optional analytics failure cannot undo the
    // message, and consent is checked while both profile locks are still held.
    await recordRoomEventInTransaction(client, userId, roomId, "message_sent");
    return { ok: true, message: { id, body, mine: true, createdAt } };
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
    if (isReservedDemoIdentity(userId) || isReservedDemoIdentity(room.other_id)) return "not_found";
    await client.query(
      "INSERT INTO safety_reports (id, reporter_id, reported_id, room_id, reason) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (reporter_id, room_id) DO NOTHING",
      [randomUUID(), userId, room.other_id, roomId, reason],
    );
    await client.query("INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, room.other_id]);
    await client.query("UPDATE rooms SET active = 0 WHERE id = $1", [roomId]);
    return "reported";
  });
}

/** Normalize an Instagram username, or return null if Instagram wouldn't accept it. */
export function normalizeInstagramHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const handle = input.trim().replace(/^@/, "").toLowerCase();
  return /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

export type InstagramResult =
  | { ok: true; instagram: InstagramExchange }
  | { ok: false; reason: "not_found" | "invalid" | "closed" };

async function readExchange(client: PoolClient, userId: string, roomId: string, room: LockedRoom): Promise<InstagramExchange> {
  const { rows } = await client.query<{ user_id: string; handle: string }>(
    "SELECT user_id, handle FROM instagram_shares WHERE room_id = $1",
    [roomId],
  );
  const theirs = rows.find((row) => row.user_id === room.other_id)?.handle ?? null;
  return {
    mine: rows.find((row) => row.user_id === userId)?.handle ?? null,
    theirsReady: theirs !== null,
    theirs: room.closed ? theirs : null,
    closed: room.closed,
  };
}

/** Share (or change) the actor's handle. When both members have shared, the room closes. */
export async function shareInstagram(userId: string, roomId: string, input: unknown): Promise<InstagramResult> {
  const handle = normalizeInstagramHandle(input);
  if (!handle) return { ok: false, reason: "invalid" };
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return { ok: false, reason: "not_found" };
    if (room.closed) return { ok: false, reason: "closed" };
    await client.query(
      `INSERT INTO instagram_shares (room_id, user_id, handle) VALUES ($1, $2, $3)
       ON CONFLICT (room_id, user_id) DO UPDATE SET handle = EXCLUDED.handle, created_at = now()`,
      [roomId, userId, handle],
    );
    // The room lock serializes both members, so exactly one share sees the other's.
    const { rowCount } = await client.query(
      "SELECT 1 FROM instagram_shares WHERE room_id = $1 AND user_id = $2",
      [roomId, room.other_id],
    );
    if (rowCount) {
      await client.query("UPDATE rooms SET closed_at = now() WHERE id = $1", [roomId]);
      room.closed = true;
    }
    return { ok: true, instagram: await readExchange(client, userId, roomId, room) };
  });
}

/** Take back the actor's handle before the other member has shared theirs. */
export async function withdrawInstagram(userId: string, roomId: string): Promise<InstagramResult> {
  return withTransaction(getDb(), async (client) => {
    const room = await lockAllowedRoom(client, userId, roomId);
    if (!room) return { ok: false, reason: "not_found" };
    if (room.closed) return { ok: false, reason: "closed" };
    await client.query("DELETE FROM instagram_shares WHERE room_id = $1 AND user_id = $2", [roomId, userId]);
    return { ok: true, instagram: await readExchange(client, userId, roomId, room) };
  });
}
