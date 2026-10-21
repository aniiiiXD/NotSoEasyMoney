import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { auth, authConfigured, googleConfigured, signIn } from "@/auth";
import { signInErrorMessage } from "./auth-error";
import { getDb } from "@/lib/db";
import { getActiveReferral, REFERRAL_COOKIE, verifyReferralCode } from "@/lib/referrals";
import styles from "./sign-in.module.css";

async function googleLogin() {
  "use server";
  if (!authConfigured || !googleConfigured) redirect("/sign-in?error=Configuration");
  try {
    await signIn("google", { redirectTo: "/signup/complete" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=OAuthSignInError");
    throw error;
  }
}

async function clearReferral() {
  "use server";
  (await cookies()).delete(REFERRAL_COOKIE);
  redirect("/sign-in");
}

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string; referral?: string }>;
}) {
  if (authConfigured && (await auth())?.user?.id) redirect("/join");
  const { error, referral: referralStatus } = await searchParams;
  const errorMessage = signInErrorMessage(error);
  const code = verifyReferralCode((await cookies()).get(REFERRAL_COOKIE)?.value, process.env.AUTH_SECRET);
  const referral = code && process.env.DATABASE_URL ? await getActiveReferral(getDb(), code) : null;
  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}><span className="brand-mark" aria-hidden="true" />Mystery Match</Link>
        <Link href="/" className={styles.home}>Back home <span aria-hidden="true">→</span></Link>
      </header>
      <section className={styles.card}>
        <p className={styles.eyebrow}>WELCOME TO MYSTERY MATCH</p>
        <h1>Good to see you.</h1>
        <p className={styles.intro}>Sign in to start making more meaningful connections.</p>
        {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
        {referralStatus === "invalid" && <p className={styles.error} role="status">This invitation link is invalid or no longer active.</p>}
        {referral && <div className={styles.referral}>
          <p>Invited by <strong>{referral.label}</strong>. If you create an account, your signup will be counted for this invitation.</p>
          <form action={clearReferral}><button type="submit">Remove invitation</button></form>
        </div>}
        <form action={googleLogin}>
          <button className={styles.google} type="submit" disabled={!googleConfigured || !authConfigured}>
            <span className={styles.googleMark} aria-hidden="true">G</span> Continue with Google
          </button>
        </form>
        {!authConfigured && !process.env.VERCEL && <p className={styles.setup}>Sign-in needs local setup. See the project setup guide to get started.</p>}
        {!googleConfigured && <p className={styles.setup}>Google sign-in will be available once connected.</p>}
        <p className={styles.fine}>For adults 18 and over. Your Google account is used to sign in, not to build your public profile.</p>
      </section>
      <p className={styles.foot}>A little more getting to know you.</p>
    </main>
  );
}
