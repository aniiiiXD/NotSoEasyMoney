import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { getDb } from "@/lib/db";
import { recordEvent } from "@/lib/analytics";
import { authorizeDemo, localDemoEnabled } from "@/app/sign-in/demo";

export const googleConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
export const authConfigured = Boolean(process.env.AUTH_SECRET);
export const localTestLoginEnabled =
  process.env.NODE_ENV === "development" && process.env.LOCAL_TEST_LOGIN === "true";

type LocalAccount = { user_id: string; password_salt: string; password_hash: string };

// Local test accounts are deliberately unavailable outside development and do
// not use or expose Google identity. They are never production authentication.
function authorizeLocalTest(handleInput: unknown, passwordInput: unknown, request: Request) {
  if (!localTestLoginEnabled || !authConfigured) return null;
  const hostname = new URL(request.url).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "[::1]") return null;
  if (typeof handleInput !== "string" || typeof passwordInput !== "string") return null;
  const handle = handleInput.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,24}$/.test(handle) || passwordInput.length < 8 || passwordInput.length > 128) return null;

  const db = getDb();
  let account = db.prepare("SELECT user_id, password_salt, password_hash FROM local_test_accounts WHERE handle = ?").get(handle) as LocalAccount | undefined;
  if (!account) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(passwordInput, salt, 64).toString("hex");
    const userId = `local:${randomUUID()}`;
    // A concurrent attempt to create the same handle must never replace it.
    db.prepare("INSERT OR IGNORE INTO local_test_accounts (handle, user_id, password_salt, password_hash) VALUES (?, ?, ?, ?)")
      .run(handle, userId, salt, hash);
    account = db.prepare("SELECT user_id, password_salt, password_hash FROM local_test_accounts WHERE handle = ?").get(handle) as LocalAccount | undefined;
  }
  if (!account) return null;
  const expected = Buffer.from(account.password_hash, "hex");
  const actual = scryptSync(passwordInput, account.password_salt, expected.length);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { id: account.user_id };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt" },
  providers: [
    ...(googleConfigured ? [Google({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      checks: ["pkce", "state"],
      // Auth.js supplies a fresh internal ID for OAuth users without an adapter.
      // Preserve the stable provider subject as providerAccountId, not personal data.
      profile(profile) {
        if (!profile.sub) throw new Error("Google did not provide a subject");
        return { id: profile.sub, name: null, email: null, image: null };
      },
    })] : []),
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
  callbacks: {
    jwt({ token, user, account }) {
      if (account?.provider === "google" && account.providerAccountId) {
        token.userId = `google:${account.providerAccountId}`;
      } else if (user?.id) {
        token.userId = user.id;
      }
      // Do not put Google profile details into the session or its token.
      delete token.name;
      delete token.email;
      delete token.picture;
      delete token.sub;
      return token;
    },
    session({ session, token }) {
      return {
        expires: session.expires,
        ...(typeof token.userId === "string" ? { user: { id: token.userId } } : {}),
      };
    },
  },
  events: {
    signIn({ user, account }) {
      const userId = account?.provider === "google" && account.providerAccountId
        ? `google:${account.providerAccountId}` : user.id;
      if (userId) {
        try { recordEvent(userId, "signed_in"); } catch { /* Analytics is optional. */ }
      }
    },
  },
});
