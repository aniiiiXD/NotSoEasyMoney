import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { isObservabilityAdmin, observabilitySnapshot } from "@/lib/observability";
import styles from "./observability.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function ms(value: number | null): string {
  return value === null ? "—" : `${value} ms`;
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

export default async function ObservabilityPage() {
  if (!isObservabilityAdmin((await auth())?.user?.id)) redirect("/");
  const snapshot = await observabilitySnapshot(getDb());
  const peak = Math.max(1, ...snapshot.hourly.map((point) => point.total));
  const errorTotal = snapshot.kinds.reduce((sum, kind) => sum + kind.errors, 0);
  const recentHour = snapshot.hourly.at(-1)?.total ?? 0;

  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/">Mystery Match</Link>
      <Link href="/admin/referrals">Referral links</Link>
    </header>

    <p className={styles.eyebrow}>UNLISTED · OPERATOR DASHBOARD · LAST {snapshot.windowHours}H (IST)</p>
    <h1>Observability.</h1>
    <p className={styles.intro}>Every API request, chat action, payment step and provider webhook, as they happen. Content is never recorded — only shapes, timings and outcomes.</p>

    <section className={styles.grid}>
      <div className={styles.stat}><strong>{snapshot.totalEvents.toLocaleString("en-IN")}</strong><span>events in window</span></div>
      <div className={styles.stat}><strong>{recentHour.toLocaleString("en-IN")}</strong><span>events last hour</span></div>
      <div className={styles.stat}><strong>{snapshot.distinctActors.toLocaleString("en-IN")}</strong><span>active members</span></div>
      <div className={errorTotal > 0 ? `${styles.stat} ${styles.bad}` : styles.stat}><strong>{errorTotal.toLocaleString("en-IN")}</strong><span>server errors / crashes</span></div>
      <div className={styles.stat}><strong>{snapshot.chat.messagesSent.toLocaleString("en-IN")}</strong><span>messages sent</span></div>
      <div className={styles.stat}><strong>{snapshot.payments.ordersCreated.toLocaleString("en-IN")}</strong><span>orders created</span></div>
    </section>

    <section className={styles.section}>
      <h2>Request volume</h2>
      <p className={styles.hint}>Events per hour.</p>
      {snapshot.hourly.length === 0 ? <p className={styles.empty}>No events in this window yet.</p> : <div>
        <div className={styles.bars}>
          {snapshot.hourly.map((point) => (
            <div key={point.hour} className={styles.bar} style={{ height: `${Math.max(2, Math.round((point.total / peak) * 100))}%` }} title={`${time(point.hour)} — ${point.total} events`} />
          ))}
        </div>
        <div className={styles.barLabel}>
          {snapshot.hourly.map((point) => <span key={point.hour}>{time(point.hour).slice(0, 2)}</span>)}
        </div>
      </div>}
    </section>

    <section className={styles.section}>
      <h2>Per-endpoint latency &amp; errors</h2>
      <p className={styles.hint}>p50 / p95 of request duration. rejected = client errors (4xx); server errors and crashes are the real alarms.</p>
      {snapshot.kinds.length === 0 ? <p className={styles.empty}>Nothing recorded yet.</p> : <table className={styles.table}>
        <thead><tr><th>Endpoint</th><th className={styles.num}>Requests</th><th className={styles.num}>p50</th><th className={styles.num}>p95</th><th className={styles.num}>Rejected</th><th className={styles.num}>Server errors</th></tr></thead>
        <tbody>
          {snapshot.kinds.map((kind) => <tr key={kind.kind}>
            <td className={styles.mono}>{kind.kind}</td>
            <td className={styles.num}>{kind.total.toLocaleString("en-IN")}</td>
            <td className={styles.num}>{ms(kind.p50)}</td>
            <td className={styles.num}>{ms(kind.p95)}</td>
            <td className={styles.num}>{(kind.total - kind.ok - kind.errors).toLocaleString("en-IN")}</td>
            <td className={`${styles.num} ${kind.errors > 0 ? styles.err : ""}`}>{kind.errors.toLocaleString("en-IN")}</td>
          </tr>)}
        </tbody>
      </table>}
    </section>

    <section className={styles.section}>
      <h2>Chat engine</h2>
      <div className={styles.funnel}>
        <div className={styles.funnelStep}><strong>{snapshot.chat.roomsRead.toLocaleString("en-IN")}</strong><span>room reads</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong>{snapshot.chat.messagesSent.toLocaleString("en-IN")}</strong><span>messages sent</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong className={snapshot.chat.rateLimited > 0 ? styles.err : undefined}>{snapshot.chat.rateLimited.toLocaleString("en-IN")}</strong><span>rate limited</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong>{snapshot.chat.reports.toLocaleString("en-IN")}</strong><span>reports</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong>{snapshot.chat.blocks.toLocaleString("en-IN")}</strong><span>blocks</span></div>
      </div>
    </section>

    <section className={styles.section}>
      <h2>Payment funnel</h2>
      <div className={styles.funnel}>
        <div className={styles.funnelStep}><strong>{snapshot.payments.ordersCreated.toLocaleString("en-IN")}</strong><span>orders created</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong>{snapshot.payments.verified.toLocaleString("en-IN")}</strong><span>verified payments</span></div>
        <span className={styles.funnelArrow}>→</span>
        <div className={styles.funnelStep}><strong>{snapshot.payments.reveals.toLocaleString("en-IN")}</strong><span>reveals unlocked</span></div>
        <span className={styles.funnelArrow}>·</span>
        <div className={styles.funnelStep}><strong className={snapshot.payments.webhookFailures > 0 ? styles.err : undefined}>{snapshot.payments.webhookFailures.toLocaleString("en-IN")}</strong><span>webhook non-OK</span></div>
      </div>
    </section>

    <section className={styles.section}>
      <h2>Recent problems</h2>
      <p className={styles.hint}>Last 40 non-OK events in the window, newest first.</p>
      {snapshot.problems.length === 0 ? <p className={styles.empty}>No problems recorded. Suspiciously peaceful.</p> : <table className={styles.table}>
        <thead><tr><th>Time (IST)</th><th>Endpoint</th><th>Outcome</th><th>Detail</th></tr></thead>
        <tbody>
          {snapshot.problems.map((problem, index) => <tr key={`${problem.ts}-${index}`}>
            <td className={styles.mono}>{time(problem.ts)}</td>
            <td className={styles.mono}>{problem.kind}</td>
            <td className={styles.mono}>{problem.outcome}</td>
            <td className={styles.mono}>{problem.detail ? JSON.stringify(problem.detail).slice(0, 120) : "—"}</td>
          </tr>)}
        </tbody>
      </table>}
    </section>

    <section className={styles.section}>
      <h2>Storage &amp; database</h2>
      <div className={styles.funnel}>
        <div className={styles.funnelStep}><strong>{snapshot.dbHealth.eventsTotal.toLocaleString("en-IN")}</strong><span>events retained</span></div>
        <div className={styles.funnelStep}><strong>{bytes(snapshot.dbHealth.tableBytes)}</strong><span>table size</span></div>
        <div className={styles.funnelStep}><strong>{snapshot.dbHealth.oldestEvent ? new Date(snapshot.dbHealth.oldestEvent).toLocaleDateString("en-IN") : "—"}</strong><span>oldest event</span></div>
        <div className={styles.funnelStep}><strong className={(snapshot.dbHealth.deadlocks ?? 0) > 0 ? styles.err : undefined}>{snapshot.dbHealth.deadlocks === null ? "—" : snapshot.dbHealth.deadlocks.toLocaleString("en-IN")}</strong><span>deadlocks (all time)</span></div>
      </div>
    </section>

    <p className={styles.footer}>Events older than 90 days are pruned when this page loads. This dashboard shows operational data only; member analytics lives separately and requires separate consent. Refresh the page for the latest.</p>
  </main>;
}
