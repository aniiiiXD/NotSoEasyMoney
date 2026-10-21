import NextAuth from "next-auth";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { recordEvent } from "@/lib/analytics";
import { REFERRAL_COOKIE, registerGoogleAccount, verifyReferralCode } from "@/lib/referrals";
import { createAuthCallbacks, googleProvider, googleSignInAvailable, localAuthCookies } from "@/lib/auth-config";

export const googleConfigured = googleSignInAvailable();
export const authConfigured = Boolean(process.env.AUTH_SECRET?.trim());
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  ...(process.env.NODE_ENV === "development" ? { cookies: localAuthCookies } : {}),
  pages: { signIn: "/sign-in", error: "/sign-in" },
  session: { strategy: "jwt" },
  providers: [
    ...(googleConfigured ? [googleProvider(process.env.AUTH_GOOGLE_ID!, process.env.AUTH_GOOGLE_SECRET!)] : []),

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
