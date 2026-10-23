import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { Pool, PoolClient } from "pg";
import { recordEventInTransaction, recordRoomEventInTransaction } from "./analytics.ts";
import { lockProfiles, withTransaction } from "./db.ts";
import { isEligiblePair, rankCandidates, type Candidate, type MatchingProfile } from "./matching.ts";
import { emptyAnswers, normalizeAnswers, parsePersonalityAnswers, QUESTIONNAIRE_VERSION, type PersonalityAnswers, type PersonalityVector } from "./personality.ts";
import { isReservedDemoIdentity, sameMatchingPool } from "./demo.ts";
import { BillingError, type PaymentMode } from "./billing-config.ts";

export const GENDERS = ["woman", "man", "nonbinary", "another identity"] as const;
type Gender = (typeof GENDERS)[number];

export interface ProfileInput {
  alias: string;
  age: number;
  gender: Gender;
  seeking: Gender[];
  minAge: number;
  maxAge: number;
  answers: PersonalityAnswers;
  analyticsConsent: boolean;
}

interface ProfileRow {
  user_id: string;
  alias: string;
  age: number;
  gender: string;
  seeking: string;
  min_age: number;
  max_age: number;
  answers: string;
  vector: string;
  questionnaire_version: string;
  analytics_consent: number;
  active: number;
}

function isGender(value: unknown): value is Gender {
  return typeof value === "string" && (GENDERS as readonly string[]).includes(value);
}

// Compare UTF-8 bytes, matching PostgreSQL's C collation for user IDs.
function compareUserIds(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/** Validate data at the server boundary; client-side validation is not trusted. */
export function parseProfileInput(value: unknown): ProfileInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Profile details are required.");
  const input = value as Record<string, unknown>;
  const alias = typeof input.alias === "string" ? input.alias.trim() : "";
  if (alias.length < 2 || alias.length > 24 || /[\u0000-\u001f\u007f]/.test(alias)) throw new TypeError("Choose a nickname between 2 and 24 characters.");
  if (!Number.isSafeInteger(input.age) || (input.age as number) < 18 || (input.age as number) > 120) throw new TypeError("Mystery Match is for adults aged 18 and over.");
  if (!isGender(input.gender)) throw new TypeError("Choose how you identify.");
  if (!Array.isArray(input.seeking) || input.seeking.length < 1 || input.seeking.length > GENDERS.length || !input.seeking.every(isGender) || new Set(input.seeking).size !== input.seeking.length) throw new TypeError("Choose who you would like to meet.");
  if (!Number.isSafeInteger(input.minAge) || !Number.isSafeInteger(input.maxAge) || (input.minAge as number) < 18 || (input.maxAge as number) > 120 || (input.minAge as number) > (input.maxAge as number)) throw new TypeError("Choose a valid age range starting at 18 or older.");
  if (typeof input.analyticsConsent !== "boolean") throw new TypeError("Please choose whether to share usage analytics.");
  const answers = parsePersonalityAnswers(input.answers);
  if (Object.values(answers).filter((answer) => answer !== null).length < 3) throw new TypeError("Answer at least three questions to find introductions.");
  return { alias, age: input.age as number, gender: input.gender, seeking: input.seeking, minAge: input.minAge as number, maxAge: input.maxAge as number, answers, analyticsConsent: input.analyticsConsent };
}

type Database = Pool | PoolClient;

async function getRow(db: Database, userId: string): Promise<ProfileRow | null> {
  const result = await db.query<ProfileRow>("SELECT * FROM profiles WHERE user_id = $1", [userId]);
  return result.rows[0] ?? null;
}

/** Only call for the authenticated person's own profile. */
export async function getOwnProfile(db: Database, userId: string): Promise<ProfileInput | null> {
  const row = await getRow(db, userId);
  if (!row) return null;
  // Answers to an earlier questionnaire don't fit the current questions, so the person starts the questions again.
  const answers = row.questionnaire_version === QUESTIONNAIRE_VERSION ? JSON.parse(row.answers) : emptyAnswers();
  return { alias: row.alias, age: row.age, gender: row.gender as Gender, seeking: JSON.parse(row.seeking), minAge: row.min_age, maxAge: row.max_age, answers, analyticsConsent: row.analytics_consent === 1 };
}

export async function saveProfile(db: Pool, userId: string, value: unknown): Promise<{ created: boolean }> {
  const profile = parseProfileInput(value);
  const vector = normalizeAnswers(profile.answers);
  return withTransaction(db, async (client) => {
    if (userId.startsWith("google:")) {
      const account = await client.query("SELECT user_id FROM app_users WHERE user_id = $1 FOR UPDATE", [userId]);
      if (!account.rowCount) throw new Error("Account unavailable");
    }
    // All pair-sensitive operations use this same order for profile locks.
    await lockProfiles(client, [userId]);
    const values = [userId, profile.alias, profile.age, profile.gender, JSON.stringify(profile.seeking), profile.minAge, profile.maxAge, JSON.stringify(profile.answers), JSON.stringify(vector), QUESTIONNAIRE_VERSION, profile.analyticsConsent ? 1 : 0];
    const inserted = await client.query(`INSERT INTO profiles
      (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`, values);
    const created = inserted.rowCount === 1;
    if (!created) {
      // Only the consent endpoint may change consent after creation. An old
      // profile form must not silently undo a later opt-out.
      await client.query(`UPDATE profiles SET alias=$2, age=$3, gender=$4, seeking=$5,
        min_age=$6, max_age=$7, answers=$8, vector=$9, questionnaire_version=$10,
        updated_at=$11 WHERE user_id=$1`, [...values.slice(0, 10), new Date().toISOString()]);
    }

    await client.query("DELETE FROM candidate_tokens WHERE viewer_id = $1 OR target_id = $1", [userId]);
    if (created) {
      await client.query("UPDATE referral_attributions SET profile_completed_at = now() WHERE user_id = $1 AND profile_completed_at IS NULL", [userId]);
      await recordEventInTransaction(client, userId, "onboarding_completed");
    }
    await recordEventInTransaction(client, userId, "profile_saved");
    return { created };
  });
}

function asMatchingProfile(row: ProfileRow, blocked: string[], passed: string[]): MatchingProfile {
  let vector: PersonalityVector;
  let seeking: string[];
  try {
    vector = JSON.parse(row.vector);
    seeking = JSON.parse(row.seeking);
  } catch {
    vector = {} as PersonalityVector;
    seeking = [];
  }
  return { userId: row.user_id, active: row.active === 1, age: row.age, gender: row.gender, preferences: { acceptedGenders: seeking, minAge: row.min_age, maxAge: row.max_age }, questionnaireVersion: row.questionnaire_version, vector, blockedUserIds: blocked, excludedUserIds: passed };
}

/** Fetch exclusions only for the profiles being compared, without an N+1 query. */
async function matchingProfiles(db: Database, rows: ProfileRow[]): Promise<Map<string, MatchingProfile>> {
  const ids = rows.map((row) => row.user_id);
  if (ids.length === 0) return new Map();
  const blocked = await db.query<{ actor_id: string; target_id: string }>(
    "SELECT blocker_id AS actor_id, blocked_id AS target_id FROM blocks WHERE blocker_id = ANY($1::text[]) AND blocked_id = ANY($1::text[]) AND (blocker_id = $2 OR blocked_id = $2)", [ids, ids[0]]);
  const passed = await db.query<{ actor_id: string; target_id: string }>(
    "SELECT actor_id, target_id FROM decisions WHERE actor_id = ANY($1::text[]) AND target_id = ANY($1::text[]) AND (actor_id = $2 OR target_id = $2) AND decision = 'pass'", [ids, ids[0]]);
  const blockedByActor = new Map<string, string[]>();
  const passedByActor = new Map<string, string[]>();
  for (const item of blocked.rows) blockedByActor.set(item.actor_id, [...(blockedByActor.get(item.actor_id) ?? []), item.target_id]);
  for (const item of passed.rows) passedByActor.set(item.actor_id, [...(passedByActor.get(item.actor_id) ?? []), item.target_id]);
  return new Map(rows.map((row) => [row.user_id, asMatchingProfile(row, blockedByActor.get(row.user_id) ?? [], passedByActor.get(row.user_id) ?? [])]));
}

export async function listCandidates(db: Pool, viewerId: string, billing?: { mode: PaymentMode; reveal?: boolean }): Promise<Candidate[] | null> {
  return withTransaction(db, async (client) => {
    // Only an explicit POST may spend a payment. Serialize competing reveals.
    if (billing?.reveal) await client.query("SELECT user_id FROM app_users WHERE user_id = $1 FOR UPDATE", [viewerId]);
    const initialViewer = await getRow(client, viewerId);
    if (!initialViewer) return null;
    if (isReservedDemoIdentity(viewerId)) return [];
    const poolClause = "substr(p.user_id, 1, 5) <> 'demo:' AND substr(p.user_id, 1, 7) <> 'sample:'";
    const values = [viewerId];
    const proposed = await client.query<{ user_id: string }>(`SELECT p.user_id FROM profiles p WHERE p.user_id <> $1 AND p.active = 1 AND ${poolClause}
      AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.actor_id = $1 AND d.target_id = p.user_id)
      AND NOT EXISTS (SELECT 1 FROM rooms r WHERE (r.user_a = $1 AND r.user_b = p.user_id) OR (r.user_b = $1 AND r.user_a = p.user_id))
      ORDER BY p.user_id COLLATE "C" LIMIT 200`, values);
    if (proposed.rows.length === 0) return [];
    const proposedIds = proposed.rows.map(({ user_id }) => user_id);

    // Key-share locks allow discovery requests to run together, while edits,
    // decisions and blocks using the profile write locks wait. Acquire all
    // locks in the same order before issuing tokens to avoid lock inversions.
    await client.query('SELECT user_id FROM profiles WHERE user_id = ANY($1::text[]) ORDER BY user_id COLLATE "C" FOR KEY SHARE', [[viewerId, ...proposedIds]]);
    const fresh = await client.query<ProfileRow>(`SELECT p.* FROM profiles p
      WHERE p.user_id = $1 OR (p.user_id = ANY($2::text[]) AND p.active = 1
        AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.actor_id = $1 AND d.target_id = p.user_id)
        AND NOT EXISTS (SELECT 1 FROM rooms r WHERE (r.user_a = $1 AND r.user_b = p.user_id) OR (r.user_b = $1 AND r.user_a = p.user_id)))`, [viewerId, proposedIds]);
    const viewerRow = fresh.rows.find((row) => row.user_id === viewerId);
    if (!viewerRow) return null;
    const rows = fresh.rows.filter((row) => row.user_id !== viewerId).sort((a, b) => compareUserIds(a.user_id, b.user_id));
    const profiles = await matchingProfiles(client, [viewerRow, ...rows]);
    const viewer = profiles.get(viewerId)!;
    const eligible = rows.flatMap((row) => {
      const profile = profiles.get(row.user_id)!;
      return isEligiblePair(viewer, profile) ? [{ row, profile }] : [];
    });
    if (eligible.length === 0) return [];

    const now = Date.now();
    // A single upsert keeps an unexpired token stable even when two discovery
    // requests run at once. Candidate IDs never contain account IDs.
    const tokens = await client.query<{ target_id: string; token: string }>(`INSERT INTO candidate_tokens AS existing
      (token, viewer_id, target_id, expires_at)
      SELECT proposed.token, $1, proposed.target_id, $2
      FROM unnest($3::text[], $4::text[]) AS proposed(token, target_id)
      ON CONFLICT (viewer_id, target_id) DO UPDATE SET
        token = CASE WHEN existing.expires_at > $5 THEN existing.token ELSE EXCLUDED.token END,
        expires_at = EXCLUDED.expires_at
      RETURNING target_id, token`, [viewerId, now + 7 * 24 * 60 * 60 * 1000, eligible.map(() => randomUUID()), eligible.map(({ row }) => row.user_id), now]);
    const tokenByTarget = new Map(tokens.rows.map(({ target_id, token }) => [target_id, token]));
    const ranked = rankCandidates(viewer, eligible.map(({ row, profile }) => ({
      profile, candidateId: tokenByTarget.get(row.user_id)!, blindAlias: row.alias,
    })));
    if (!billing) return ranked;
    const unlocked = await client.query<{ target_id: string }>(`SELECT i.target_id FROM paid_introductions i
      JOIN payment_orders o ON o.order_id = i.order_id
      WHERE i.viewer_id = $1 AND i.mode = $2 AND o.status = 'paid'`, [viewerId, billing.mode]);
    const visibleTargets = new Set(unlocked.rows.map(row => row.target_id));
    const targetByToken = new Map(tokens.rows.map(row => [row.token, row.target_id]));
    if (billing.reveal) {
      // Retrying the reveal or refreshing never spends another payment while
      // there is an undecided introduction. No eligible person means no spend.
      const existing = ranked.some(candidate => visibleTargets.has(targetByToken.get(candidate.candidateId)!));
      const next = ranked.find(candidate => !visibleTargets.has(targetByToken.get(candidate.candidateId)!));
      if (!existing && next) {
        const order = await client.query<{ order_id: string }>(`SELECT o.order_id FROM payment_orders o
          WHERE o.user_id = $1 AND o.mode = $2 AND o.status = 'paid'
          AND NOT EXISTS (SELECT 1 FROM paid_introductions i WHERE i.order_id = o.order_id)
          ORDER BY o.created_at, o.order_id LIMIT 1 FOR UPDATE`, [viewerId, billing.mode]);
        if (!order.rows[0]) throw new BillingError("Pay for one new introduction to continue.", 402);
        const targetId = targetByToken.get(next.candidateId)!;
        await client.query("INSERT INTO paid_introductions (order_id, viewer_id, target_id, mode) VALUES ($1,$2,$3,$4)", [order.rows[0].order_id, viewerId, targetId, billing.mode]);
        visibleTargets.add(targetId);
      }
    }
    return ranked.filter(candidate => visibleTargets.has(targetByToken.get(candidate.candidateId)!));
  });
}

type DecisionResult = "matched" | "pending" | "passed" | "unavailable";
type NewMatch = { roomId: string; firstUserId: string; secondUserId: string };

export async function decideCandidate(db: Pool, viewerId: string, token: string, decision: "like" | "pass", onMatch?: (roomId: string, firstUserId: string, secondUserId: string) => void | Promise<void>, paidMode?: PaymentMode): Promise<DecisionResult> {
  const result = await withTransaction<{ status: DecisionResult; newMatch: NewMatch | null }>(db, async (client) => {
    if (decision !== "like" && decision !== "pass") return { status: "unavailable", newMatch: null };
    const initial = await client.query<{ target_id: string }>(
      "SELECT target_id FROM candidate_tokens WHERE token = $1 AND viewer_id = $2 AND expires_at > $3", [token, viewerId, Date.now()]);
    const targetId = initial.rows[0]?.target_id;
    if (!targetId || !sameMatchingPool(viewerId, targetId)) return { status: "unavailable", newMatch: null };
    if (paidMode && !(await client.query(`SELECT 1 FROM paid_introductions i JOIN payment_orders o ON o.order_id = i.order_id
      WHERE i.viewer_id = $1 AND i.target_id = $2 AND i.mode = $3 AND o.status = 'paid'`, [viewerId, targetId, paidMode])).rowCount) throw new BillingError("This introduction has not been unlocked.", 402);

    // Recheck every mutable condition after taking the shared pair locks. This
    // serializes simultaneous likes, blocks, and profile edits for the pair.
    await lockProfiles(client, [viewerId, targetId]);
    const item = await client.query<{ target_id: string }>(
      "SELECT target_id FROM candidate_tokens WHERE token = $1 AND viewer_id = $2 AND target_id = $3 AND expires_at > $4", [token, viewerId, targetId, Date.now()]);
    const viewer = await getRow(client, viewerId);
    const target = await getRow(client, targetId);
    const previous = await client.query("SELECT 1 FROM decisions WHERE actor_id = $1 AND target_id = $2", [viewerId, targetId]);
    if (!item.rows[0] || !viewer || !target || previous.rows.length > 0) return { status: "unavailable", newMatch: null };
    const profiles = await matchingProfiles(client, [viewer, target]);
    if (!isEligiblePair(profiles.get(viewerId)!, profiles.get(targetId)!)) return { status: "unavailable", newMatch: null };

    await client.query("INSERT INTO decisions(actor_id, target_id, decision) VALUES ($1, $2, $3)", [viewerId, targetId, decision]);
    let status: DecisionResult = decision === "pass" ? "passed" : "pending";
    let newMatch: NewMatch | null = null;
    const reverse = await client.query<{ decision: string }>("SELECT decision FROM decisions WHERE actor_id = $1 AND target_id = $2", [targetId, viewerId]);
    if (decision === "like" && reverse.rows[0]?.decision === "like") {
      // Postgres applies C collation to its canonical room-order constraint.
      const [userA, userB] = [viewerId, targetId].sort(compareUserIds);
      const roomId = randomUUID();
      const inserted = await client.query("INSERT INTO rooms(id, user_a, user_b) VALUES ($1, $2, $3) ON CONFLICT (user_a, user_b) DO NOTHING RETURNING id", [roomId, userA, userB]);
      if (inserted.rowCount === 1) {
        newMatch = { roomId, firstUserId: userA, secondUserId: userB };
        // Both participants remain locked while current consent is checked.
        await recordRoomEventInTransaction(client, userA, roomId, "match_created");
        await recordRoomEventInTransaction(client, userB, roomId, "match_created");
      }
      status = "matched";
    }
    if (status === "pending") {
      // A prior introduction issued to the other person stays valid.
      await client.query("DELETE FROM candidate_tokens WHERE viewer_id = $1 AND target_id = $2", [viewerId, targetId]);
    } else {
      await client.query("DELETE FROM candidate_tokens WHERE (viewer_id = $1 AND target_id = $2) OR (viewer_id = $2 AND target_id = $1)", [viewerId, targetId]);
    }
    return { status, newMatch };
  });
  if (result.newMatch && onMatch) {
    // Callbacks run after commit and cannot undo an already created room.
    try { await onMatch(result.newMatch.roomId, result.newMatch.firstUserId, result.newMatch.secondUserId); } catch { /* no-op */ }
  }
  return result.status;
}
