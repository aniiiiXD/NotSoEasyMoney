import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isLoopbackHost } from "@/app/sign-in/demo";
import { isDemoSession, SAMPLE_ACTIVITY, SAMPLE_FUNNEL, samplePercent } from "./sample-data";
import styles from "./sample-analytics.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sample analytics · Mystery Match", robots: { index: false, follow: false } };

export default async function DemoAnalyticsPage() {
  if (process.env.NODE_ENV !== "development" || !isLoopbackHost((await headers()).get("host"))) notFound();
  const userId = (await auth())?.user?.id;
  if (!isDemoSession(userId)) redirect("/sign-in");

  const started = SAMPLE_FUNNEL[0].count;
  const completed = SAMPLE_FUNNEL[1].count;
  const matched = SAMPLE_FUNNEL[3].count;
  const messaged = SAMPLE_FUNNEL[4].count;
  const maximumActivity = Math.max(...SAMPLE_ACTIVITY.map(({ members }) => members));
  const highlights = [
    { label: "Profile completion", value: `${samplePercent(completed, started)}%`, note: `${completed} of ${started} started` },
    { label: "Members matched", value: `${samplePercent(matched, completed)}%`, note: `${matched} of ${completed} completed profiles` },
    { label: "Started a conversation", value: `${samplePercent(messaged, matched)}%`, note: `${messaged} of ${matched} matched members` },
  ];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.wordmark}><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
          <Link href="/discover" className={styles.back}>Back to introductions <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}><span className={styles.dot} /> DEMO · SAMPLE DATA</p>
            <h1>A little perspective.</h1>
            <p className={styles.lede}>See how an analytics view could tell the story from a first hello to a first conversation.</p>
          </div>
          <div className={styles.sampleNote}>
            <strong>Just an illustration.</strong>
            <p>These are made-up numbers for a sample 30-day period. They don’t reflect real members or your demo activity.</p>
          </div>
        </div>

        <section className={styles.highlights} aria-label="Sample conversion highlights">
          {highlights.map(({ label, value, note }, index) => (
            <article key={label} className={styles.highlight}>
              <p className={styles.highlightIndex}>0{index + 1} / {label}</p>
              <p className={styles.highlightValue}>{value}</p>
              <p className={styles.highlightNote}>{note}</p>
            </article>
          ))}
        </section>

        <div className={styles.sections}>
          <section className={styles.funnel} aria-labelledby="sample-funnel-heading">
            <div className={styles.sectionTop}>
              <div>
                <p className={styles.sectionNumber}>01 / THE JOURNEY</p>
                <h2 id="sample-funnel-heading">From curious to connected.</h2>
              </div>
              <span className={styles.sectionTag}>Sample cohort · 240 people</span>
            </div>
            <p className={styles.sectionCopy}>A hypothetical group moving through each step. Percentages show the share of the previous step.</p>
            <ol className={styles.funnelList}>
              {SAMPLE_FUNNEL.map((step, index) => {
                const previous = index === 0 ? null : SAMPLE_FUNNEL[index - 1].count;
                return (
                  <li key={step.label} className={styles.funnelItem}>
                    <div className={styles.funnelLine}>
                      <span>{step.label}</span>
                      <span className={styles.funnelValue}>{step.count} <small>{previous ? `· ${samplePercent(step.count, previous)}%` : "· starting point"}</small></span>
                    </div>
                    <div className={styles.track} aria-hidden="true"><div className={styles.fill} style={{ width: `${samplePercent(step.count, started)}%` }} /></div>
                  </li>
                );
              })}
            </ol>
            <p className={styles.detail}>Each count represents a different stage of the same illustrative cohort, not the number of matches or messages.</p>
          </section>

          <section className={styles.activity} aria-labelledby="sample-activity-heading">
            <div className={styles.sectionTop}>
              <div>
                <p className={styles.sectionNumber}>02 / ACTIVITY</p>
                <h2 id="sample-activity-heading">A week at a glance.</h2>
              </div>
              <span className={styles.sectionTag}>Example week</span>
            </div>
            <p className={styles.sectionCopy}>Sample members active each day. A person can appear on more than one day.</p>
            <div className={styles.chart} aria-label="Illustrative active members by day">
              {SAMPLE_ACTIVITY.map(({ day, members }) => (
                <div key={day} className={styles.day}>
                  <span className={styles.barValue}>{members}</span>
                  <div className={styles.barTrack}><div className={styles.bar} style={{ height: `${(members / maximumActivity) * 100}%` }} /></div>
                  <span className={styles.dayLabel}>{day}</span>
                </div>
              ))}
            </div>
            <div className={styles.reading}>
              <span className={styles.readingMark} aria-hidden="true">↗</span>
              <p><strong>Reading the sample</strong><br />In this example, 60 of 96 matched members sent a first message.</p>
            </div>
          </section>
        </div>

        <div className={styles.footer}>
          <p>Illustrative figures only. Real analytics is separate and requires consent.</p>
          <Link href="/discover">Keep exploring <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </main>
  );
}
