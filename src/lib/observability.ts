import type { Pool } from "pg";
import { getDb } from "./db.ts";

/**
 * Operational observability for operators, separate from opt-in member
 * analytics. Events never contain message bodies, profile answers, or any
 * member content: only kinds, identifiers the operator already administers,
 * outcomes, timings, and small enumerations.
 */

export type Observation = {
  kind: string;
  actor?: string | null;
  outcome?: string | null;
  durationMs?: number | null;
  detail?: Record<string, unknown> | null;
};

/** Exact authenticated Google user IDs permitted to open the observability dashboard. */
export function isObservabilityAdmin(userId: unknown, env: Record<string, string | undefined> = process.env): boolean {
  if (typeof userId !== "string" || !userId || userId.length > 512) return false;
  return (env.OBSERVABILITY_ADMIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean).includes(userId);
}

/** Fire-and-forget: a logging failure must never affect the member request. */
export function observe(event: Observation, database: () => Pool = getDb): void {
  database().query(
    "INSERT INTO observability_events (kind, actor_id, outcome, duration_ms, detail) VALUES ($1, $2, $3, $4, $5)",
    [event.kind, event.actor ?? null, event.outcome ?? null, event.durationMs ?? null, event.detail ? JSON.stringify(event.detail) : null],
  ).catch(() => { /* observability must never surface to members */ });
}

function outcomeFor(status: number): string {
  if (status < 400) return "ok";
  if (status < 500) return `rejected_${status}`;
  return "server_error";
}

/**
 * Wrap a route handler. The handler resolves the signed-in actor itself and
 * returns it with the response; the wrapper records one event per request.
 */
export async function withObservability(
  kind: string,
  handler: () => Promise<{ actor: string | null; response: Response }>,
): Promise<Response> {
  const started = performance.now();
  try {
    const { actor, response } = await handler();
    observe({
      kind,
      actor,
      outcome: outcomeFor(response.status),
      durationMs: Math.round(performance.now() - started),
      detail: { status: response.status },
    });
    return response;
  } catch (error) {
    observe({
      kind,
      outcome: "crashed",
      durationMs: Math.round(performance.now() - started),
      detail: { error: error instanceof Error ? error.message.slice(0, 200) : "unknown" },
    });
    throw error;
  }
}

export type KindMetric = { kind: string; total: number; ok: number; errors: number; p50: number | null; p95: number | null };
export type HourlyPoint = { hour: string; total: number };
export type ProblemRow = { ts: string; kind: string; actor_id: string | null; outcome: string | null; detail: Record<string, unknown> | null };
export type ObservabilitySnapshot = {
  windowHours: number;
  totalEvents: number;
  distinctActors: number;
  kinds: KindMetric[];
  hourly: HourlyPoint[];
  chat: { messagesSent: number; rateLimited: number; roomsRead: number; reports: number; blocks: number };
  payments: { ordersCreated: number; verified: number; webhookFailures: number; reveals: number };
  problems: ProblemRow[];
  dbHealth: { eventsTotal: number; oldestEvent: string | null; tableBytes: number | null; deadlocks: number | null };
};

function percentileRow<T extends { p50: string | null; p95: string | null }>(row: T): { p50: number | null; p95: number | null } {
  return { p50: row.p50 === null ? null : Math.round(Number(row.p50)), p95: row.p95 === null ? null : Math.round(Number(row.p95)) };
}

/** All dashboard reads in one place so tests can exercise the exact SQL. */
export async function observabilitySnapshot(database: Pool, windowHours = 24): Promise<ObservabilitySnapshot> {
  const window = `${Math.max(1, Math.min(windowHours, 24 * 30))} hours`;
  const [kinds, hourly, chat, payments, problems, totals, dbHealth] = await Promise.all([
    database.query<{ kind: string; total: string; ok: string; errors: string; p50: string | null; p95: string | null }>(`
      SELECT kind, count(*) AS total,
        count(*) FILTER (WHERE outcome = 'ok') AS ok,
        count(*) FILTER (WHERE outcome IN ('crashed', 'server_error')) AS errors,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
      FROM observability_events WHERE ts > now() - interval '${window}'
      GROUP BY kind ORDER BY count(*) DESC`),
    database.query<{ hour: Date; total: string }>(`
      SELECT date_trunc('hour', ts) AS hour, count(*) AS total
      FROM observability_events WHERE ts > now() - interval '${window}'
      GROUP BY hour ORDER BY hour`),
    database.query<{ messages_sent: string; rate_limited: string; rooms_read: string; reports: string; blocks: string }>(`
      SELECT
        count(*) FILTER (WHERE kind = 'api.message.send' AND outcome = 'ok') AS messages_sent,
        count(*) FILTER (WHERE kind = 'api.message.send' AND outcome = 'rejected_429') AS rate_limited,
        count(*) FILTER (WHERE kind = 'api.rooms.read' AND outcome = 'ok') AS rooms_read,
        count(*) FILTER (WHERE kind = 'api.room.report' AND outcome = 'ok') AS reports,
        count(*) FILTER (WHERE kind = 'api.room.block' AND outcome = 'ok') AS blocks
      FROM observability_events WHERE ts > now() - interval '${window}'`),
    database.query<{ orders_created: string; verified: string; webhook_failures: string; reveals: string }>(`
      SELECT
        count(*) FILTER (WHERE kind = 'api.payments.create_order' AND outcome = 'ok') AS orders_created,
        count(*) FILTER (WHERE kind = 'api.payments.verify' AND outcome = 'ok') AS verified,
        count(*) FILTER (WHERE kind = 'api.payments.webhook' AND outcome <> 'ok' AND outcome IS NOT NULL) AS webhook_failures,
        count(*) FILTER (WHERE kind = 'api.reveal' AND outcome = 'ok') AS reveals
      FROM observability_events WHERE ts > now() - interval '${window}'`),
    database.query<{ ts: string; kind: string; actor_id: string | null; outcome: string | null; detail: Record<string, unknown> | null }>(`
      SELECT ts, kind, actor_id, outcome, detail
      FROM observability_events
      WHERE outcome IS NOT NULL AND outcome <> 'ok' AND ts > now() - interval '${window}'
      ORDER BY ts DESC LIMIT 40`),
    database.query<{ total: string; actors: string }>(`
      SELECT count(*) AS total, count(DISTINCT actor_id) AS actors
      FROM observability_events WHERE ts > now() - interval '${window}'`),
    Promise.all([
      database.query<{ total: string; oldest: string | null }>("SELECT count(*) AS total, min(ts) AS oldest FROM observability_events"),
      database.query<{ bytes: string | null }>("SELECT pg_total_relation_size('observability_events') AS bytes"),
      database.query<{ deadlocks: string | null }>("SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()"),
    ]),
  ]);
  // 90-day retention, pruned on dashboard reads like the analytics tables.
  await database.query("DELETE FROM observability_events WHERE ts < now() - interval '90 days'");
  const health = dbHealth[0].rows[0] ?? { total: "0", oldest: null };
  return {
    windowHours,
    totalEvents: Number(totals.rows[0]?.total ?? 0),
    distinctActors: Number(totals.rows[0]?.actors ?? 0),
    kinds: kinds.rows.map((row) => ({ kind: row.kind, total: Number(row.total), ok: Number(row.ok), errors: Number(row.errors), ...percentileRow(row) })),
    hourly: hourly.rows.map((row) => ({ hour: row.hour.toISOString(), total: Number(row.total) })),
    chat: {
      messagesSent: Number(chat.rows[0]?.messages_sent ?? 0),
      rateLimited: Number(chat.rows[0]?.rate_limited ?? 0),
      roomsRead: Number(chat.rows[0]?.rooms_read ?? 0),
      reports: Number(chat.rows[0]?.reports ?? 0),
      blocks: Number(chat.rows[0]?.blocks ?? 0),
    },
    payments: {
      ordersCreated: Number(payments.rows[0]?.orders_created ?? 0),
      verified: Number(payments.rows[0]?.verified ?? 0),
      webhookFailures: Number(payments.rows[0]?.webhook_failures ?? 0),
      reveals: Number(payments.rows[0]?.reveals ?? 0),
    },
    problems: problems.rows,
    dbHealth: {
      eventsTotal: Number(health.total ?? 0),
      oldestEvent: health.oldest ? new Date(health.oldest).toISOString() : null,
      tableBytes: dbHealth[1].rows[0]?.bytes === null || dbHealth[1].rows[0]?.bytes === undefined ? null : Number(dbHealth[1].rows[0].bytes),
      deadlocks: dbHealth[2].rows[0]?.deadlocks === null || dbHealth[2].rows[0]?.deadlocks === undefined ? null : Number(dbHealth[2].rows[0].deadlocks),
    },
  };
}
