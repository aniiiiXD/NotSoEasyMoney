import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { getAnalyticsReport, isAnalyticsAdmin } from "@/lib/analytics";
import styles from "./analytics.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !isAnalyticsAdmin(userId)) notFound();
  const report = getAnalyticsReport(userId);
  const cards = [
    { label: "Active members", description: "People with a recorded action", metric: report.metrics.activeUsers },
    { label: "Signed in", description: "People who signed in", metric: report.metrics.signedInUsers },
    { label: "Made a match", description: "People who made at least one match", metric: report.metrics.matchedUsers },
    { label: "Sent a message", description: "People who sent a message", metric: report.metrics.messagingUsers },
    { label: "Completed onboarding", description: "People who completed onboarding", metric: report.metrics.onboardingCompletedUsers },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link></header>
      <div className={styles.content}>
        <p className={styles.eyebrow}>Private · Admin only</p>
        <h1 className={styles.title}>Analytics.</h1>
        <p className={styles.copy}>A look at how consenting members use Mystery Match. This report contains counts, never conversations or personality answers.</p>
        <div className={styles.period}><p><strong>Last completed week</strong></p><p>{report.period.start.slice(0, 10)} – {report.period.end.slice(0, 10)} UTC</p><p>End date is exclusive</p></div>
        {report.status === "no_data" && <p className={styles.notice}>No activity was recorded in this period.</p>}
        {report.status === "insufficient_data" && <p className={styles.notice}>Not enough consenting members in this period to show counts safely.</p>}
        <div className={styles.metrics}>
          {cards.map(({ label, description, metric }) => <article key={label} className={styles.metric}>
            <p className={styles.metricLabel}>{label}</p><p className={styles.metricValue}>{metric.status === "available" ? `${metric.minimum}+` : "Not enough data"}</p><p className={styles.metricDescription}>{description}</p>
          </article>)}
          <article className={styles.metric}><p className={styles.metricLabel}>Weekly retention</p><p className={styles.metricValue}>{report.metrics.weeklyRetention.status === "available" ? `About ${report.metrics.weeklyRetention.percentage}%` : "Not enough data"}</p><p className={styles.metricDescription}>Members active in the previous week who were also active last week</p></article>
        </div>
        <p className={styles.note}>Counts include only members who chose to share analytics. Counts are rounded down to the nearest five and retention to the nearest five percentage points. Small groups and their complements are hidden; activity before consent is not included.</p>
      </div>
    </main>
  );
}
