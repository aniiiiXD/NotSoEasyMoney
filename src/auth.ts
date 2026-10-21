import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { recordEvent } from "@/lib/analytics";
import { REFERRAL_COOKIE, registerGoogleAccount, verifyReferralCode } from "@/lib/referrals";
import { createAuthCallbacks, googleProvider, googleSignInAvailable, localAuthCookies } from "@/lib/auth-config";
import { authorizeDemo, localDemoEnabled } from "@/app/sign-in/demo";

export const googleConfigured = googleSignInAvailable();
export const authConfigured = Boolean(process.env.AUTH_SECRET?.trim());
export const localTestLoginEnabled =
  process.env.NODE_ENV === "development" && process.env.LOCAL_TEST_LOGIN === "true";

type LocalAccount = { user_id: string; password_salt: string; password_hash: string };

// Local test accounts are deliberately unavailable outside development and do
// not use or expose Google identity. They are never production authentication.
async function authorizeLocalTest(handleInput: unknown, passwordInput: unknown, request: Request) {
  if (!localTestLoginEnabled || !authConfigured) return null;
  const hostname = new URL(request.url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") return null;
  if (typeof handleInput !== "string" || typeof passwordInput !== "string") return null;
  const handle = handleInput.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,24}$/.test(handle) || passwordInput.length < 8 || passwordInput.length > 128) return null;

  const db = getDb();
  let account = (await db.query<LocalAccount>("SELECT user_id, password_salt, password_hash FROM local_test_accounts WHERE handle = $1", [handle])).rows[0];
  if (!account) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(passwordInput, salt, 64).toString("hex");
    const userId = `local:${randomUUID()}`;
    // A concurrent attempt to create the same handle must never replace it.
    await db.query("INSERT INTO local_test_accounts (handle, user_id, password_salt, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (handle) DO NOTHING", [handle, userId, salt, hash]);
    account = (await db.query<LocalAccount>("SELECT user_id, password_salt, password_hash FROM local_test_accounts WHERE handle = $1", [handle])).rows[0];
  }
  if (!account) return null;
  const expected = Buffer.from(account.password_hash, "hex");
  const actual = scryptSync(passwordInput, account.password_salt, expected.length);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { id: account.user_id };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  ...(process.env.NODE_ENV === "development" ? { cookies: localAuthCookies } : {}),
  pages: { signIn: "/sign-in", error: "/sign-in" },
  session: { strategy: "jwt" },
  providers: [
    ...(googleConfigured ? [googleProvider(process.env.AUTH_GOOGLE_ID!, process.env.AUTH_GOOGLE_SECRET!)] : []),
    ...(localDemoEnabled() ? [Credentials({
      id: "demo",
      name: "Local demo",
      credentials: {},
      authorize(_credentials, request) {
        return authorizeDemo(request);
      },
    })] : []),
    ...(localTestLoginEnabled ? [Credentials({
      id: "local-test",
      name: "Local test account",
      credentials: { handle: {}, password: { type: "password" } },
      authorize(credentials, request) {
        return authorizeLocalTest(credentials.handle, credentials.password, request);
      },
    })] : []),
  ],
  callbacks: createAuthCallbacks({
    async readPendingReferral() {
      const pending = (await cookies()).get(REFERRAL_COOKIE)?.value;
      return verifyReferralCode(pending, process.env.AUTH_SECRET);
    },
    async registerGoogleAccount(userId, code) {
      await registerGoogleAccount(getDb(), userId, code);
    },
    async accountVersion(userId) {
      return (await getDb().query<{ session_version: string }>("SELECT session_version FROM app_users WHERE user_id = $1", [userId])).rows[0]?.session_version ?? null;
    },
  }),
  events: {
    async signIn({ user, account }) {
      const userId = account?.provider === "google"
        ? (account.providerAccountId ? `google:${account.providerAccountId}` : undefined)
        : user.id;
      if (userId) {
        try { await recordEvent(userId, "signed_in"); } catch { /* Analytics is optional. */ }
      }
    },
  },
});
