import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getOwnProfile } from "@/lib/local-matching";
import { hasAnswers } from "@/lib/personality";
import { discoveryAccess } from "@/lib/discovery-access";
import { formatPaymentAmount } from "@/lib/billing-config";
import CheckoutButton from "./checkout-button";
import styles from "../app.module.css";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const userId = (await auth())?.user?.id;
  if (!userId) redirect("/sign-in");
  const profile = await getOwnProfile(getDb(), userId);
  if (!profile || !hasAnswers(profile.answers)) redirect("/join?edit=1");
  const access = await discoveryAccess(userId);
  if (access.allowed) redirect("/discover");
  const price = formatPaymentAmount(access.amount);
  const testMode = access.mode === "test";
  return <main className={styles.page}>
    <header className={styles.header}><div className={styles.headerTop}>
      <Link className={styles.wordmark} href="/">Mystery Match</Link>
      <Link className={styles.headerLink} href="/account">Account & support</Link>
    </div></header>
    <section className={styles.narrow}>
      <div className={styles.intro}>
        <p className={styles.kicker}>{testMode ? "TEST MODE · NO REAL CHARGE" : "ONE INTRODUCTION"}</p>
        <h1>Your profile is ready.</h1>
        <p>Pay to reveal one new person. Your profile is saved, so you can come back whenever you’re ready.</p>
      </div>
      <dl className={styles.paymentSummary}><div><dt>One new introduction</dt><dd>{price}</dd></div></dl>
      <p className={styles.helper}>Each payment reveals one person, not a guaranteed mutual match. No subscription. If nobody is eligible, your unused payment stays saved. Viewing an unlocked introduction again and using an existing chat cost nothing extra.</p>
      <CheckoutButton configured={access.configured} testMode={testMode} amount={access.amount} price={price} />
      <p className={styles.helper}><Link href="/join?edit=1">Review my profile</Link> · <Link href="/support">Contact support</Link></p>
    </section>
  </main>;
}
