import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// A Vercel deployment cannot use the local SQLite file as shared storage.
// Keep the provider disabled there until the hosted data layer is implemented.
export function googleSignInAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return !env.VERCEL && Boolean(env.AUTH_GOOGLE_ID?.trim() && env.AUTH_GOOGLE_SECRET?.trim());
}

// Browsers share cookies across ports. Namespace development cookies so an
// unrelated Auth.js app on localhost cannot replace this app's session/state.
// Auth.js still supplies its normal request-specific security options.
export const localAuthCookies = {
  sessionToken: { name: "mystery-match-dev.session-token" },
  callbackUrl: { name: "mystery-match-dev.callback-url" },
  csrfToken: { name: "mystery-match-dev.csrf-token" },
  pkceCodeVerifier: { name: "mystery-match-dev.pkce.code_verifier" },
  state: { name: "mystery-match-dev.state" },
  nonce: { name: "mystery-match-dev.nonce" },
} satisfies NextAuthConfig["cookies"];

// Google requires openid plus either profile or email. We do not request email
// and discard the profile fields: only the stable Google subject is used.
export function googleProvider(clientId: string, clientSecret: string) {
  return Google({
    clientId,
    clientSecret,
    authorization: { params: { scope: "openid profile" } },
    checks: ["pkce", "state", "nonce"],
    profile(profile) {
      if (typeof profile.sub !== "string" || !profile.sub) {
        throw new Error("Google did not provide a subject");
      }
      return { id: profile.sub, name: null, email: null, image: null };
    },
  });
}

export const authCallbacks = {
  jwt({ token, user, account }) {
    if (account?.provider === "google") {
      // Auth.js gives OAuth users a temporary internal ID without an adapter.
      // Never fall back to that ID if the stable Google subject is missing.
      if (!account.providerAccountId) return null;
      token.userId = `google:${account.providerAccountId}`;
    } else if (user?.id) {
      token.userId = user.id;
    }
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
} satisfies NonNullable<NextAuthConfig["callbacks"]>;
