import type { PoolClient } from "pg";
import { getDb, lockProfiles, withTransaction } from "./db.ts";

/**
 * Server-only analytics. Callers must use the authenticated session's user ID,
 * never an ID supplied in request JSON. There is no properties argument: events
 * contain no message, profile, or matching data and are unique per UTC day.
 */
export const ANALYTICS_EVENTS = [
  "signed_in",
  "onboarding_started",
  "onboarding_completed",
  "profile_saved",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
type RoomAnalyticsEvent = "message_sent" | "match_created";

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
 * Remove events older than 90 days. Report reads and standalone event writes
 * call this opportunistically. Schedule it separately to enforce expiry while
 * the app is idle or only transaction-scoped product events are being recorded.
 */
export async function pruneAnalyticsEvents(): Promise<number> {
  const result = await getDb().query(
    `DELETE FROM analytics_events
      WHERE occurred_at < to_char((clock_timestamp() - interval '90 days') AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );
  return result.rowCount ?? 0;
}

/**
 * A failed analytics statement must not poison an enclosing product transaction.
 * Roll back only the optional work. If the savepoint or rollback itself fails,
 * propagate the error: the connection cannot safely commit the product change.
 * Calls on the same client must be awaited sequentially, not run in parallel.
 */
async function optionalAnalytics(client: PoolClient, action: () => Promise<boolean>): Promise<boolean> {
  await client.query("SAVEPOINT optional_analytics");
  try {
    const recorded = await action();
    await client.query("RELEASE SAVEPOINT optional_analytics");
    return recorded;
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT optional_analytics");
    await client.query("RELEASE SAVEPOINT optional_analytics");
    return false;
  }
}

/**
 * Record a single-person event inside the product transaction. The caller should
 * hold the actor's profile lock and call this after the product write. Checking
 * consent before that transaction commits avoids capturing pre-consent activity
 * if consent changes while a post-commit callback is waiting to run.
 */
export async function recordEventInTransaction(
  client: PoolClient,
  userId: string,
  event: AnalyticsEvent,
): Promise<boolean> {
  if (!isValidUserId(userId) || isSampleUserId(userId) || !eventNames.has(event)) return false;
  return optionalAnalytics(client, async () => {
    await lockProfiles(client, [userId]);
    const result = await client.query(
      `INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata)
       SELECT p.user_id, $2,
              to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T00:00:00.000Z', '{}'
         FROM profiles AS p
        WHERE p.user_id = $1 AND p.analytics_consent = 1
       ON CONFLICT DO NOTHING`,
      [userId, event],
    );
    return result.rowCount === 1;
  });
}

/**
 * Standalone event, such as a completed sign-in. Optional analytics failures
 * never interrupt the product flow. Product writes should instead call the
 * transaction-scoped helper before they commit.
 */
export async function recordEvent(userId: string, event: AnalyticsEvent): Promise<boolean> {
  if (!isValidUserId(userId) || isSampleUserId(userId) || !eventNames.has(event)) return false;
  try {
    await pruneAnalyticsEvents();
    return await withTransaction(getDb(), (client) => recordEventInTransaction(client, userId, event));
  } catch {
    return false;
  }
}

/**
 * Record pair-derived activity in the same transaction as the product write.
 * Call after the message/new-room write while the two participants' profile
 * locks are held. Only the actor and UTC day are stored, never the other member,
 * room, or message. This helper rechecks membership, active room and both
 * consents under the same profile locks used by consent withdrawal.
 */
export async function recordRoomEventInTransaction(
  client: PoolClient,
  userId: string,
  roomId: string,
  event: RoomAnalyticsEvent,
): Promise<boolean> {
  if (
    !isValidUserId(userId) || isSampleUserId(userId) || !isValidUserId(roomId) ||
    (event !== "message_sent" && event !== "match_created")
  ) return false;

  return optionalAnalytics(client, async () => {
    // Discover the pair without locking the room, then lock profiles first in
    // canonical order. Product operations use the same profiles-before-room order.
    const roomResult = await client.query<{ user_a: string; user_b: string }>(
      `SELECT user_a, user_b FROM rooms
        WHERE id = $1 AND active = 1 AND (user_a = $2 OR user_b = $2)`,
      [roomId, userId],
    );
    const room = roomResult.rows[0];
    if (!room) return false;
    const otherId = room.user_a === userId ? room.user_b : room.user_a;
    if (!isValidUserId(otherId) || isSampleUserId(otherId)) return false;
    await lockProfiles(client, [userId, otherId]);

    // Recheck the room under a row lock after taking the participant locks.
    const activeRoom = await client.query(
      `SELECT 1 FROM rooms
        WHERE id = $1 AND active = 1
          AND ((user_a = $2 AND user_b = $3) OR (user_a = $3 AND user_b = $2))
        FOR SHARE`,
      [roomId, userId, otherId],
    );
    if (activeRoom.rowCount !== 1) return false;

    const result = await client.query(
      `INSERT INTO analytics_events (user_id, event_name, occurred_at, metadata)
       SELECT actor.user_id, $3,
              to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || 'T00:00:00.000Z', '{}'
         FROM profiles AS actor
         JOIN profiles AS other ON other.user_id = $2
        WHERE actor.user_id = $1 AND actor.analytics_consent = 1 AND other.analytics_consent = 1
       ON CONFLICT DO NOTHING`,
      [userId, otherId, event],
    );
    return result.rowCount === 1;
  });
}

/**
 * Standalone wrappers are useful for isolated tests. Production message and
 * match flows use recordRoomEventInTransaction so consent is checked at the
 * instant of the product write, without a post-commit consent race.
 */
async function recordRoomEvent(userId: string, roomId: string, event: RoomAnalyticsEvent): Promise<boolean> {
  if (!isValidUserId(userId) || isSampleUserId(userId) || !isValidUserId(roomId)) return false;
  try {
    await pruneAnalyticsEvents();
    return await withTransaction(getDb(), (client) => recordRoomEventInTransaction(client, userId, roomId, event));
  } catch {
    return false;
  }
}

export async function recordMessageEvent(userId: string, roomId: string): Promise<boolean> {
  return recordRoomEvent(userId, roomId, "message_sent");
}

export async function recordMatchEvent(userId: string, roomId: string): Promise<boolean> {
  return recordRoomEvent(userId, roomId, "match_created");
}

/** Returns null when the authenticated user has not yet created a profile. */
export async function getAnalyticsConsent(userId: string): Promise<boolean | null> {
  if (!isValidUserId(userId)) return null;
  const result = await getDb().query<{ analytics_consent: number }>(
    "SELECT analytics_consent FROM profiles WHERE user_id = $1",
    [userId],
  );
  return result.rows[0] ? result.rows[0].analytics_consent === 1 : null;
}

function isRetryableTransactionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "40P01" || error.code === "40001");
}

/** Changing consent and deleting withdrawn data happen in one transaction. */
export async function setAnalyticsConsent(userId: string, enabled: boolean): Promise<boolean> {
  if (!isValidUserId(userId) || typeof enabled !== "boolean") return false;
  // Concurrent withdrawals can encounter a PostgreSQL deadlock during the
  // global pair-event purge. A rejected transaction changes nothing; retry it
  // in a fresh transaction, while surfacing unrelated failures to the caller.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withTransaction(getDb(), async (client) => {
        await lockProfiles(client, [userId]);
        const previous = await client.query<{ analytics_consent: number }>(
          "SELECT analytics_consent FROM profiles WHERE user_id = $1",
          [userId],
        );
        if (!previous.rows[0]) return false;

        await client.query("UPDATE profiles SET analytics_consent = $2 WHERE user_id = $1", [userId, enabled ? 1 : 0]);
        if (!enabled) {
          await client.query("DELETE FROM analytics_events WHERE user_id = $1", [userId]);
          // Pair identities are not kept in analytics. A real account's withdrawal
          // therefore clears all pair-derived events to remove indirect traces.
          if (previous.rows[0].analytics_consent === 1 && !isSampleUserId(userId)) {
            await client.query("DELETE FROM analytics_events WHERE event_name IN ('message_sent', 'match_created')");
          }
        }
        return true;
      });
    } catch (error) {
      if (attempt >= 2 || !isRetryableTransactionError(error)) throw error;
    }
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

function countNumber(value: string | number): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid analytics count");
  return count;
}

/**
 * Fixed-week aggregate report. The server-only admin check is repeated here so
 * alternate entry points fail closed. The report's two queries share a snapshot;
 * small cells and their complements are suppressed, and counts are rounded down.
 */
export async function getAnalyticsReport(userId: string, now: Date = new Date()): Promise<AnalyticsReport> {
  if (!isAnalyticsAdmin(userId)) throw new Error("Analytics access denied");
  await pruneAnalyticsEvents();
  const period = lastClosedUtcWeek(now);
  const previousWeekStart = new Date(Date.parse(period.start) - 7 * 86_400_000).toISOString();

  return withTransaction(getDb(), async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const { rows: [row] } = await client.query<{
      active: string; signed_in: string; messaging: string; matched: string; onboarding: string;
    }>(
      `SELECT COUNT(DISTINCT user_id) AS active,
              COUNT(DISTINCT CASE WHEN event_name = 'signed_in' THEN user_id END) AS signed_in,
              COUNT(DISTINCT CASE WHEN event_name = 'message_sent' THEN user_id END) AS messaging,
              COUNT(DISTINCT CASE WHEN event_name = 'match_created' THEN user_id END) AS matched,
              COUNT(DISTINCT CASE WHEN event_name = 'onboarding_completed' THEN user_id END) AS onboarding
         FROM analytics_events
        WHERE occurred_at >= $1 AND occurred_at < $2
          AND event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                             'profile_saved', 'message_sent', 'match_created')`,
      [period.start, period.end],
    );
    const { rows: [retention] } = await client.query<{ eligible: string; retained: string }>(
      `SELECT COUNT(DISTINCT previous.user_id) AS eligible,
              COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM analytics_events AS current
                 WHERE current.user_id = previous.user_id
                   AND current.occurred_at >= $1 AND current.occurred_at < $2
                   AND current.event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                                              'profile_saved', 'message_sent', 'match_created')
              ) THEN previous.user_id END) AS retained
         FROM analytics_events AS previous
        WHERE previous.occurred_at >= $3 AND previous.occurred_at < $1
          AND previous.event_name IN ('signed_in', 'onboarding_started', 'onboarding_completed',
                                      'profile_saved', 'message_sent', 'match_created')`,
      [period.start, period.end, previousWeekStart],
    );
    const active = countNumber(row.active);
    const signedIn = countNumber(row.signed_in);
    const messaging = countNumber(row.messaging);
    const matched = countNumber(row.matched);
    const onboarding = countNumber(row.onboarding);
    const eligible = countNumber(retention.eligible);
    const retained = countNumber(retention.retained);
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
  });
}
