import { getDb } from "./db.ts";

/**
 * Local, server-only analytics. The caller must supply the authenticated actor
 * from the server session, never a user ID from the request body. There is no
 * properties argument: message content, profile data, and matching data cannot
 * be added to an event. Events are recorded at most once per user and UTC day.
 */
export const ANALYTICS_EVENTS = [
  "signed_in",
  "onboarding_started",
  "onboarding_completed",
  "profile_saved",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

const eventNames = new Set<string>(ANALYTICS_EVENTS);
const minimumCohort = 20;
const countBucket = 5;

type Metric = {
  status: "available" | "insufficient_data";
  /** A lower bound rounded down to a multiple of five, never an exact small count. */
  minimum: number | null;
};

type RetentionMetric = {
  status: "available" | "insufficient_data";
  /** A percentage rounded to the nearest five, never a raw cohort count. */
  percentage: number | null;
};

export type AnalyticsReport = {
  period: { start: string; end: string; timezone: "UTC" };
  status: "no_data" | "available" | "insufficient_data";
  metrics: {
    activeUsers: Metric;
    signedInUsers: Metric;
    messagingUsers: Metric;
    matchedUsers: Metric;
    onboardingCompletedUsers: Metric;
    weeklyRetention: RetentionMetric;
  };
};

function isValidUserId(userId: unknown): userId is string {
  return typeof userId === "string" && userId.length > 0 && userId.length <= 512;
}

// Demonstration activity must never contribute to the real aggregate report.
function isSampleUserId(userId: string): boolean {
  return userId.startsWith("demo:") || userId.startsWith("sample:");
}

/** An explicit server environment allowlist is required; no user is an admin by default. */
export function isAnalyticsAdmin(userId: unknown): boolean {
  if (!isValidUserId(userId)) return false;
  const ids = (process.env.ANALYTICS_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.includes(userId);
}

/**
 * Remove local events older than 90 days. This runs on analytics writes and
 * report reads; call it from a scheduled local maintenance job when an expiry
 * deadline must be enforced even if the app receives no traffic.
 */
export function pruneAnalyticsEvents(): number {
  const result = getDb()
    .prepare(
      "DELETE FROM analytics_events WHERE occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')",
    )
    .run();
  return Number(result.changes);
}

/**
 * Record an allowlisted event only when the actor has explicitly opted in.
 * It never throws into the product flow if analytics storage fails.
 */
export function recordEvent(userId: string, event: AnalyticsEvent): boolean {
  if (!isValidUserId(userId) || isSampleUserId(userId) || !eventNames.has(event)) return false;
  try {
    pruneAnalyticsEvents();
    const result = getDb()
      .prepare(
        `INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata)
         SELECT p.user_id, ?, strftime('%Y-%m-%dT00:00:00.000Z', 'now'), '{}'
           FROM profiles AS p
          WHERE p.user_id = ? AND p.analytics_consent = 1
            AND NOT EXISTS (
              SELECT 1 FROM analytics_events AS e
               WHERE e.user_id = p.user_id AND e.event_name = ?
                 AND e.occurred_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')
                 AND e.occurred_at < strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')
            )`,
      )
      .run(event, userId, event);
    return Number(result.changes) === 1;
  } catch {
    // Analytics is optional and must never break sign-in, chat, or onboarding.
    return false;
  }
}

function recordRoomEvent(userId: string, roomId: string, event: "message_sent" | "match_created"): boolean {
  if (!isValidUserId(userId) || isSampleUserId(userId) || !isValidUserId(roomId)) return false;
  try {
    pruneAnalyticsEvents();
    const result = getDb()
      .prepare(
        `INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata)
         SELECT actor.user_id, ?, strftime('%Y-%m-%dT00:00:00.000Z', 'now'), '{}'
           FROM rooms AS room
           JOIN profiles AS actor ON actor.user_id = ?
           JOIN profiles AS other ON other.user_id = CASE
             WHEN room.user_a = actor.user_id THEN room.user_b ELSE room.user_a END
          WHERE room.id = ? AND room.active = 1
            AND (room.user_a = actor.user_id OR room.user_b = actor.user_id)
            AND actor.analytics_consent = 1 AND other.analytics_consent = 1
            AND other.user_id NOT LIKE 'demo:%' AND other.user_id NOT LIKE 'sample:%'
            AND NOT EXISTS (
              SELECT 1 FROM analytics_events AS e
               WHERE e.user_id = actor.user_id AND e.event_name = ?
                 AND e.occurred_at >= strftime('%Y-%m-%dT00:00:00.000Z', 'now')
                 AND e.occurred_at < strftime('%Y-%m-%dT00:00:00.000Z', 'now', '+1 day')
            )`,
      )
      .run(event, userId, roomId, event);
    return Number(result.changes) === 1;
  } catch {
    return false;
  }
}

/**
 * Called only after a message is stored. Checks actual room membership and
 * both participants' current consent in the insertion statement. The room,
 * other participant, and message are never stored with the resulting event.
 */
export function recordMessageEvent(userId: string, roomId: string): boolean {
  return recordRoomEvent(userId, roomId, "message_sent");
}

/** Called once for each participant, after a new room is committed. */
export function recordMatchEvent(userId: string, roomId: string): boolean {
  return recordRoomEvent(userId, roomId, "match_created");
}

/** Returns null when the authenticated user has not yet created a profile. */
export function getAnalyticsConsent(userId: string): boolean | null {
  if (!isValidUserId(userId)) return null;
  const row = getDb()
    .prepare("SELECT analytics_consent FROM profiles WHERE user_id = ?")
    .get(userId) as { analytics_consent: number } | undefined;
  return row ? row.analytics_consent === 1 : null;
}

/** Changing consent and deleting withdrawn data happen in one SQLite transaction. */
export function setAnalyticsConsent(userId: string, enabled: boolean): boolean {
  if (!isValidUserId(userId) || typeof enabled !== "boolean") return false;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const previous = db.prepare("SELECT analytics_consent FROM profiles WHERE user_id = ?").get(userId) as
      | { analytics_consent: number }
      | undefined;
    const result = db
      .prepare("UPDATE profiles SET analytics_consent = ? WHERE user_id = ?")
      .run(enabled ? 1 : 0, userId);
    if (Number(result.changes) !== 1) {
      db.exec("ROLLBACK");
      return false;
    }
    if (!enabled) {
      db.prepare("DELETE FROM analytics_events WHERE user_id = ?").run(userId);
      // We intentionally do not keep pair/room identities in analytics. Thus,
      // when either participant withdraws, the safe way to remove all possible
      // indirect traces is to clear the shared pair-derived metrics for everyone.
      if (previous?.analytics_consent === 1 && !isSampleUserId(userId)) {
        db.prepare("DELETE FROM analytics_events WHERE event_name IN ('message_sent', 'match_created')").run();
      }
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** The last fully closed Monday-to-Monday UTC week, not a live or user-selected window. */
export function lastClosedUtcWeek(now: Date = new Date()): { start: string; end: string } {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid date");
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const end = midnight - daysSinceMonday * 86_400_000;
  return {
    start: new Date(end - 7 * 86_400_000).toISOString(),
    end: new Date(end).toISOString(),
  };
}

function metric(count: number, complement?: number): Metric {
  if (count < minimumCohort || (complement !== undefined && complement < minimumCohort)) {
    return { status: "insufficient_data", minimum: null };
  }
  return { status: "available", minimum: Math.floor(count / countBucket) * countBucket };
}

/**
 * Fixed-week, aggregate-only report. Call using an authenticated server session
 * ID. The check is repeated here so alternate server entry points fail closed.
 * Small cells and their complements are suppressed; counts are rounded down.
 */
export function getAnalyticsReport(userId: string, now: Date = new Date()): AnalyticsReport {
  if (!isAnalyticsAdmin(userId)) throw new Error("Analytics access denied");
  pruneAnalyticsEvents();
  const period = lastClosedUtcWeek(now);
  const previousWeekStart = new Date(Date.parse(period.start) - 7 * 86_400_000).toISOString();
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS active,
              COUNT(DISTINCT CASE WHEN event_name = 'signed_in' THEN user_id END) AS signed_in,
              COUNT(DISTINCT CASE WHEN event_name = 'message_sent' THEN user_id END) AS messaging,
              COUNT(DISTINCT CASE WHEN event_name = 'match_created' THEN user_id END) AS matched,
              COUNT(DISTINCT CASE WHEN event_name = 'onboarding_completed' THEN user_id END) AS onboarding
         FROM analytics_events
        WHERE occurred_at >= ? AND occurred_at < ?
          AND event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                             'profile_saved', 'message_sent', 'match_created')`,
    )
    .get(period.start, period.end) as {
    active: number;
    signed_in: number;
    messaging: number;
    matched: number;
    onboarding: number;
  };
  const retention = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT previous.user_id) AS eligible,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM analytics_events AS current
                 WHERE current.user_id = previous.user_id
                   AND current.occurred_at >= ? AND current.occurred_at < ?
                   AND current.event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                                              'profile_saved', 'message_sent', 'match_created')
              ) THEN previous.user_id END) AS retained
         FROM analytics_events AS previous
        WHERE previous.occurred_at >= ? AND previous.occurred_at < ?
          AND previous.event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                                      'profile_saved', 'message_sent', 'match_created')`,
    )
    .get(period.start, period.end, previousWeekStart, period.start) as { eligible: number; retained: number };
  const active = Number(row.active);
  const signedIn = Number(row.signed_in);
  const messaging = Number(row.messaging);
  const matched = Number(row.matched);
  const onboarding = Number(row.onboarding);
  const eligible = Number(retention.eligible);
  const retained = Number(retention.retained);
  const canShowRetention = retained >= minimumCohort && eligible - retained >= minimumCohort;
  return {
    period: { ...period, timezone: "UTC" },
    status: active === 0 ? "no_data" : active < minimumCohort ? "insufficient_data" : "available",
    metrics: {
      activeUsers: metric(active),
      signedInUsers: metric(signedIn, active - signedIn),
      messagingUsers: metric(messaging, active - messaging),
      matchedUsers: metric(matched, active - matched),
      onboardingCompletedUsers: metric(onboarding, active - onboarding),
      weeklyRetention: canShowRetention
        ? { status: "available", percentage: Math.round((retained / eligible) * 20) * 5 }
        : { status: "insufficient_data", percentage: null },
    },
  };
}
