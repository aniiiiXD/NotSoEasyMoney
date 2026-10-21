import Link from "next/link";
import { auth } from "@/auth";
import { getAnalyticsConsent } from "@/lib/analytics";
import { ConsentControls } from "./consent-controls";
import styles from "../analytics.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnalyticsConsentPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const enabled = userId ? await getAnalyticsConsent(userId) : null;
  return (
    <main className={styles.page}>
      <header className={styles.header}><Link href="/"><span className="brand-mark" aria-hidden="true" />Mystery Match</Link></header>
      <div className={`${styles.content} ${styles.narrow}`}>
        <p className={styles.eyebrow}>Your privacy</p>
        <h1 className={styles.title}>Analytics, on your terms.</h1>
        <p className={styles.copy}>If you opt in, Mystery Match records a small set of activity events to understand how the product is used. Events never include message text, profile answers, compatibility scores, or the identity of another member.</p>
        <p className={styles.copy}>Analytics is off by default and stored in the app’s hosted database. Turning it off deletes your recorded analytics events.</p>
        {!userId ? (
          <p className={styles.copy}><Link href="/sign-in">Sign in</Link> and create a profile to manage this setting.</p>
        ) : enabled === null ? (
          <p className={styles.copy}>Create your profile to manage this setting.</p>
        ) : (
          <ConsentControls initialEnabled={enabled} />
        )}
      </div>
    </main>
  );
}
