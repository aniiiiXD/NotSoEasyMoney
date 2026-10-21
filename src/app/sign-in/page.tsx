import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { auth, authConfigured, googleConfigured, localTestLoginEnabled, signIn } from "@/auth";
import { isLoopbackHost, localDemoEnabled } from "./demo";
import { signInErrorMessage } from "./auth-error";
import styles from "./sign-in.module.css";

async function googleLogin() {
  "use server";
  if (!authConfigured || !googleConfigured) redirect("/sign-in?error=Configuration");
  try {
    await signIn("google", { redirectTo: "/join" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=OAuthSignInError");
    throw error;
  }
}

async function localLogin(formData: FormData) {
  "use server";
  if (!localTestLoginEnabled || !authConfigured) redirect("/sign-in?error=Configuration");
  try {
    await signIn("local-test", {
      handle: formData.get("handle"),
      password: formData.get("password"),
      redirectTo: "/join",
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=CredentialsSignin");
    throw error;
  }
}

async function demoLogin() {
  "use server";
  if (!localDemoEnabled() || !isLoopbackHost((await headers()).get("host"))) redirect("/sign-in?error=Configuration");
  try {
    await signIn("demo", { redirectTo: "/join" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=Configuration");
    throw error;
  }
}

export default async function SignInPage({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (authConfigured && (await auth())?.user?.id) redirect("/join");
  const { error } = await searchParams;
  const errorMessage = signInErrorMessage(error);
  const showDemo = localDemoEnabled() && isLoopbackHost((await headers()).get("host"));
  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link href="/" className={styles.brand}>Mystery Match</Link>
        <Link href="/" className={styles.home}>Back home <span aria-hidden="true">→</span></Link>
      </header>
      <section className={styles.card}>
        <p className={styles.eyebrow}>WELCOME TO MYSTERY MATCH</p>
        <h1>Good to see you.</h1>
        <p className={styles.intro}>Sign in to start making more meaningful connections.</p>
        {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
        {showDemo && <div className={styles.demo}>
          <form action={demoLogin}><button className={styles.demoButton} type="submit">Try the local demo</button></form>
          <p>Explore with sample profiles. Starting the demo creates a fresh session on this device.</p>
          <div className={styles.rule}><span>OR SIGN IN</span></div>
        </div>}
        <form action={googleLogin}>
          <button className={styles.google} type="submit" disabled={!googleConfigured || !authConfigured}>
            <span className={styles.googleMark} aria-hidden="true">G</span> Continue with Google
          </button>
        </form>
        {!authConfigured && !process.env.VERCEL && <p className={styles.setup}>Sign-in needs local setup. See the project setup guide to get started.</p>}
        {!googleConfigured && <p className={styles.setup}>Google sign-in will be available once connected.</p>}
        {localTestLoginEnabled && authConfigured && <details className={styles.local}>
          <summary>Use a local test account</summary>
          <p>Test without Google. A new handle creates a local account; use the same passphrase to return.</p>
          <form action={localLogin} className={styles.localForm}>
            <label>Test handle<input name="handle" required minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]+" autoComplete="username" placeholder="e.g. stargazer" /></label>
            <label>Passphrase<input name="password" type="password" required minLength={8} maxLength={128} autoComplete="current-password" placeholder="At least 8 characters" /></label>
            <button className={styles.localButton} type="submit">Continue with test account</button>
          </form>
        </details>}
        <p className={styles.fine}>For adults 18 and over. Your Google account is used to sign in, not to build your public profile.</p>
      </section>
      <p className={styles.foot}>A little more getting to know you.</p>
    </main>
  );
}
