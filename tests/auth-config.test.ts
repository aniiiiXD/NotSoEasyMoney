import { test } from "node:test";
import assert from "node:assert/strict";
import { authCallbacks, googleProvider } from "../src/lib/auth-config.ts";
import { signInErrorMessage } from "../src/app/sign-in/auth-error.ts";

test("Google sign-in uses a stable subject without storing profile data", async () => {
  const token = await authCallbacks.jwt({
    token: { name: "Name", email: "private@example.com", picture: "https://example.test/pic", sub: "temporary" },
    user: { id: "temporary-random-id" },
    account: { provider: "google", providerAccountId: "stable-subject", type: "oidc" },
  });
  assert.deepEqual(token, { userId: "google:stable-subject" });
  const missingSubject = await authCallbacks.jwt({
    token: {},
    user: { id: "temporary-random-id" },
    account: { provider: "google", providerAccountId: "", type: "oidc" },
  });
  assert.equal(missingSubject, null);
});

test("Google provider requests only the basic profile scope and checks all OAuth protections", () => {
  const provider = googleProvider("disposable-client-id", "disposable-client-secret");
  assert.equal(provider.options?.authorization?.params?.scope, "openid profile");
  assert.deepEqual(provider.options?.checks, ["pkce", "state", "nonce"]);
  assert.deepEqual(provider.options?.profile?.({ sub: "abc", aud: "test", azp: "test", iss: "test", iat: 1, exp: 2, given_name: "Private", name: "Private", email: "private@example.com", email_verified: true, picture: "https://example.test/pic" }, {}),
    { id: "abc", name: null, email: null, image: null });
});

test("sign-in errors are helpful without reflecting untrusted values", () => {
  assert.match(signInErrorMessage("CredentialsSignin")!, /handle or passphrase/);
  assert.match(signInErrorMessage("OAuthCallbackError")!, /cancelled or couldn’t be completed/);
  assert.match(signInErrorMessage("Configuration")!, /isn’t set up/);
  assert.equal(signInErrorMessage(undefined), undefined);
  assert.equal(signInErrorMessage("private-internal-provider-error"), "Sign-in couldn’t be completed. Please try again.");
});
