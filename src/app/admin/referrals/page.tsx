import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { isReferralAdmin, listReferralSummaries } from "@/lib/referrals";
import ReferralDashboard from "./referral-dashboard";
import styles from "./referrals.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ReferralPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  if (!isReferralAdmin(userId)) notFound();
  const referrals = await listReferralSummaries(getDb());
  return <main className={styles.page}>
    <header className={styles.header}><Link href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link><Link href="/discover">Back to app</Link></header>
    <div className={styles.content}>
      <p className={styles.eyebrow}>PRIVATE · ADMIN ONLY</p>
      <h1>Influencer links.</h1>
      <p className={styles.intro}>Create a unique link for each creator and see the people who sign up through it.</p>
      <ReferralDashboard initialReferrals={referrals} />
    </div>
  </main>;
}
