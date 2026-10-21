import Link from "next/link";
import { getDb } from "@/lib/db";
import { listReferralSummaries } from "@/lib/referrals";
import ReferralDashboard from "./referral-dashboard";
import styles from "./referrals.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const referrals = await listReferralSummaries(getDb());
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link><Link href="/discover">Back to app</Link></header>
    <div className={styles.content}>
      <p className={styles.eyebrow}>UNLISTED · OPERATOR DASHBOARD</p>
      <h1>Influencer links.</h1>
      <p className={styles.intro}>Create a unique link for each creator and see the people who sign up through it. Anyone who finds this unlisted URL can manage these links.</p>
      <ReferralDashboard initialReferrals={referrals} />
    </div>
  </main>;
}
