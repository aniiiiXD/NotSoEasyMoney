import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isEligiblePair, rankCandidates, type Candidate, type MatchingProfile } from "./matching.ts";
import { normalizeAnswers, parsePersonalityAnswers, QUESTIONNAIRE_VERSION, type PersonalityAnswers, type PersonalityVector } from "./personality.ts";
import { isDemoViewer, isReservedDemoIdentity, isSampleForViewer, sameMatchingPool, sampleId, SAMPLE_PROFILES } from "./demo.ts";

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

function getRow(db: DatabaseSync, userId: string): ProfileRow | null {
  return (db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as unknown as ProfileRow | undefined) ?? null;
}

/** Only call for the authenticated person's own profile. */
export function getOwnProfile(db: DatabaseSync, userId: string): ProfileInput | null {
  const row = getRow(db, userId);
  if (!row) return null;
  return { alias: row.alias, age: row.age, gender: row.gender as Gender, seeking: JSON.parse(row.seeking), minAge: row.min_age, maxAge: row.max_age, answers: JSON.parse(row.answers), analyticsConsent: row.analytics_consent === 1 };
}

export function saveProfile(db: DatabaseSync, userId: string, value: unknown): { created: boolean } {
  const profile = parseProfileInput(value);
  const vector = normalizeAnswers(profile.answers);
  db.exec("BEGIN IMMEDIATE");
  try {
    const previousProfile = getRow(db, userId);
    const created = !previousProfile;
    db.prepare(`INSERT INTO profiles (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias, age=excluded.age, gender=excluded.gender,
      seeking=excluded.seeking, min_age=excluded.min_age, max_age=excluded.max_age, answers=excluded.answers,
      vector=excluded.vector, questionnaire_version=excluded.questionnaire_version,
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(userId, profile.alias, profile.age, profile.gender, JSON.stringify(profile.seeking), profile.minAge, profile.maxAge, JSON.stringify(profile.answers), JSON.stringify(vector), QUESTIONNAIRE_VERSION, profile.analyticsConsent ? 1 : 0);
    if (isDemoViewer(userId)) {
      // These samples belong exclusively to this demo session. Make them
      // compatible with the viewer's preferences without changing any prior
      // decisions, blocks, or conversations when the viewer edits a profile.
      const insertSample = db.prepare(`INSERT INTO profiles
        (user_id, alias, age, gender, seeking, min_age, max_age, answers, vector, questionnaire_version, analytics_consent)
        VALUES (?, ?, ?, ?, ?, 18, 120, ?, ?, ?, 0)
        ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias, age=excluded.age,
        gender=excluded.gender, seeking=excluded.seeking, min_age=excluded.min_age,
        max_age=excluded.max_age, answers=excluded.answers, vector=excluded.vector,
        questionnaire_version=excluded.questionnaire_version,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`);
      for (const sample of SAMPLE_PROFILES) {
        insertSample.run(sampleId(userId, sample.key), sample.alias, profile.minAge, profile.seeking[0],
          JSON.stringify([profile.gender]), JSON.stringify(sample.answers), JSON.stringify(normalizeAnswers(sample.answers)), QUESTIONNAIRE_VERSION);
      }
    }
    db.prepare("DELETE FROM candidate_tokens WHERE viewer_id = ? OR target_id = ?").run(userId, userId);
    // After creation, only the consent endpoint can change this setting. This
    // prevents an old profile form from silently undoing a later opt-out.
    db.exec("COMMIT");
    return { created };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function asMatchingProfile(db: DatabaseSync, row: ProfileRow): MatchingProfile {
  const blocked = db.prepare("SELECT blocked_id AS id FROM blocks WHERE blocker_id = ?").all(row.user_id) as { id: string }[];
  const passed = db.prepare("SELECT target_id AS id FROM decisions WHERE actor_id = ? AND decision = 'pass'").all(row.user_id) as { id: string }[];
  let vector: PersonalityVector;
  let seeking: string[];
  try {
    vector = JSON.parse(row.vector);
    seeking = JSON.parse(row.seeking);
  } catch {
    vector = {} as PersonalityVector;
    seeking = [];
  }
  return { userId: row.user_id, active: row.active === 1, age: row.age, gender: row.gender, preferences: { acceptedGenders: seeking, minAge: row.min_age, maxAge: row.max_age }, questionnaireVersion: row.questionnaire_version, vector, blockedUserIds: blocked.map((item) => item.id), excludedUserIds: passed.map((item) => item.id) };
}

export function listCandidates(db: DatabaseSync, viewerId: string): Candidate[] | null {
  const viewerRow = getRow(db, viewerId);
  if (!viewerRow) return null;
  if (isReservedDemoIdentity(viewerId) && !isDemoViewer(viewerId)) return [];
  const viewer = asMatchingProfile(db, viewerRow);
  const candidatePool = isDemoViewer(viewerId)
    ? { clause: "p.user_id IN (?, ?, ?)", values: SAMPLE_PROFILES.map(({ key }) => sampleId(viewerId, key)) }
    : { clause: "substr(p.user_id, 1, 5) <> 'demo:' AND substr(p.user_id, 1, 7) <> 'sample:'", values: [] };
  const rows = db.prepare(`SELECT * FROM profiles p WHERE p.user_id <> ? AND p.active = 1 AND ${candidatePool.clause}
    AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.actor_id = ? AND d.target_id = p.user_id)
    AND NOT EXISTS (SELECT 1 FROM rooms r WHERE (r.user_a = ? AND r.user_b = p.user_id) OR (r.user_b = ? AND r.user_a = p.user_id))
    LIMIT 200`).all(viewerId, ...candidatePool.values, viewerId, viewerId, viewerId) as unknown as ProfileRow[];
  const inputs = [];
  for (const row of rows) {
    const profile = asMatchingProfile(db, row);
    if (!isEligiblePair(viewer, profile)) continue;
    const now = Date.now();
    const old = db.prepare("SELECT token, expires_at FROM candidate_tokens WHERE viewer_id = ? AND target_id = ?").get(viewerId, row.user_id) as { token: string; expires_at: number } | undefined;
    const token = old && old.expires_at > now ? old.token : randomUUID();
    db.prepare(`INSERT INTO candidate_tokens(token, viewer_id, target_id, expires_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(viewer_id, target_id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at`).run(token, viewerId, row.user_id, now + 7 * 24 * 60 * 60 * 1000);
    inputs.push({ profile, candidateId: token, blindAlias: row.alias });
  }
  const ranked = rankCandidates(viewer, inputs);
  return isDemoViewer(viewerId)
    ? ranked.map((candidate) => ({ ...candidate, explanation: "A sample introduction for this local demo." }))
    : ranked;
}

export function decideCandidate(db: DatabaseSync, viewerId: string, token: string, decision: "like" | "pass", onMatch?: (roomId: string, firstUserId: string, secondUserId: string) => void): "matched" | "pending" | "passed" | "unavailable" {
  db.exec("BEGIN IMMEDIATE");
  try {
    const item = db.prepare("SELECT target_id FROM candidate_tokens WHERE token = ? AND viewer_id = ? AND expires_at > ?").get(token, viewerId, Date.now()) as { target_id: string } | undefined;
    const viewer = getRow(db, viewerId);
    const target = item && getRow(db, item.target_id);
    const previous = item && db.prepare("SELECT 1 FROM decisions WHERE actor_id = ? AND target_id = ?").get(viewerId, item.target_id);
    if (!item || !viewer || !target || previous || !sameMatchingPool(viewerId, item.target_id) || !isEligiblePair(asMatchingProfile(db, viewer), asMatchingProfile(db, target))) {
      db.exec("ROLLBACK");
      return "unavailable";
    }
    db.prepare("INSERT INTO decisions(actor_id, target_id, decision) VALUES (?, ?, ?)").run(viewerId, item.target_id, decision);
    if (decision === "like" && isSampleForViewer(viewerId, item.target_id)) {
      // A sample's prewritten reciprocal like lets the normal mutual-match
      // path create the room; it can never opt in for another demo session.
      db.prepare("INSERT OR IGNORE INTO decisions(actor_id, target_id, decision) VALUES (?, ?, 'like')").run(item.target_id, viewerId);
    }
    let result: "matched" | "pending" | "passed" = decision === "pass" ? "passed" : "pending";
    let newMatch: { roomId: string; firstUserId: string; secondUserId: string } | null = null;
    const reverse = db.prepare("SELECT decision FROM decisions WHERE actor_id = ? AND target_id = ?").get(item.target_id, viewerId) as { decision: string } | undefined;
    if (decision === "like" && reverse?.decision === "like") {
      const [userA, userB] = [viewerId, item.target_id].sort();
      const roomId = randomUUID();
      const inserted = db.prepare("INSERT OR IGNORE INTO rooms(id, user_a, user_b) VALUES (?, ?, ?)").run(roomId, userA, userB);
      if (Number(inserted.changes) === 1) newMatch = { roomId, firstUserId: userA, secondUserId: userB };
      result = "matched";
    }
    if (result === "pending") {
      // The other person's already-open introduction remains valid until they
      // decide, even when it was loaded before this like.
      db.prepare("DELETE FROM candidate_tokens WHERE viewer_id = ? AND target_id = ?").run(viewerId, item.target_id);
    } else {
      db.prepare("DELETE FROM candidate_tokens WHERE (viewer_id = ? AND target_id = ?) OR (viewer_id = ? AND target_id = ?)").run(viewerId, item.target_id, item.target_id, viewerId);
    }
    db.exec("COMMIT");
    if (newMatch && onMatch) {
      // Analytics is optional and must never undo an already committed match.
      try { onMatch(newMatch.roomId, newMatch.firstUserId, newMatch.secondUserId); } catch { /* no-op */ }
    }
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
