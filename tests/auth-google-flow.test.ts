import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { inspect } from "node:util";
import { Auth, customFetch, type AuthConfig } from "@auth/core";
import { createAuthCallbacks, googleProvider, localAuthCookies } from "../src/lib/auth-config.ts";

// This exercises Auth.js in process with a fake Google token endpoint. No
// network request or real Google account/credential is involved.
test("mock Google OAuth registers only after validation and fails closed on storage errors", async () => {
  const origin = "http://127.0.0.1:3391";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let expectedNonce = "";
  let expectedVerifierChallenge = "";
  let issueBadNonce = false;
  let failRegistration = false;
  let referralReads = 0;
  const registrations: { userId: string; referralCode: string | null }[] = [];
  const loggedErrors: unknown[] = [];
  const provider = googleProvider("test-client", "test-secret");
  provider.options = { ...provider.options,
    [customFetch]: async (input, init) => {
      const url = String(input);
      if (url === "https://accounts.google.com/.well-known/openid-configuration") {
        return Response.json({
          issuer: "https://accounts.google.com",
          authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
          token_endpoint: "https://oauth2.googleapis.com/token",
          userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
          jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
          response_types_supported: ["code"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
        });
      }
      assert.equal(url, "https://oauth2.googleapis.com/token");
      const body = init?.body as URLSearchParams;
      assert.equal(body.get("redirect_uri"), `${origin}/api/auth/callback/google`);
      const verifier = body.get("code_verifier");
      assert.ok(verifier);
      const challenge = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      assert.equal(Buffer.from(challenge).toString("base64url"), expectedVerifierChallenge);
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" })).toString("base64url");
      const claims = Buffer.from(JSON.stringify({
        iss: "https://accounts.google.com", aud: "test-client", sub: "stable-google-subject",
        iat: now, exp: now + 300, nonce: issueBadNonce ? "wrong-nonce" : expectedNonce,
        name: "Private name", email: "private@example.test", picture: "https://example.test/private.jpg",
      })).toString("base64url");
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${claims}`);
      const idToken = `${header}.${claims}.${signer.sign(privateKey, "base64url")}`;
      return Response.json({ access_token: "disposable-token", token_type: "Bearer", id_token: idToken });
    },
  };
  const callbacks = createAuthCallbacks({
    async accountVersion() { return "test-version"; },
    async readPendingReferral() {
      referralReads++;
      return "CREATOR";
    },
    async registerGoogleAccount(userId, referralCode) {
      registrations.push({ userId, referralCode });
      if (failRegistration) throw new Error("Private storage failure details");
    },
  });
  const config = {
    secret: "a-disposable-test-secret-that-is-long-enough", trustHost: true, basePath: "/api/auth",
    providers: [provider], callbacks, session: { strategy: "jwt" },
    cookies: localAuthCookies,
    pages: { signIn: "/sign-in", error: "/sign-in" },
    logger: { error(error) { loggedErrors.push(error); }, warn() {}, debug() {} },
  } satisfies AuthConfig;

  async function start() {
    const csrf = await Auth(new Request(`${origin}/api/auth/csrf`), config);
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const csrfCookie = csrf.headers.getSetCookie().find((value) => value.startsWith(`${localAuthCookies.csrfToken.name}=`));
    assert.ok(csrfCookie);
    const response = await Auth(new Request(`${origin}/api/auth/signin/google`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie.split(";", 1)[0] },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/join" }),
    }), config);
    assert.equal(response.status, 302);
    const location = response.headers.get("location");
    assert.ok(location);
    const authorization = new URL(location);
    expectedNonce = authorization.searchParams.get("nonce")!;
    expectedVerifierChallenge = authorization.searchParams.get("code_challenge")!;
    const cookies = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    const state = authorization.searchParams.get("state");
    assert.ok(state);
    return { cookies, state };
  }

  const first = await start();
  const callback = await Auth(new Request(`${origin}/api/auth/callback/google?${new URLSearchParams({ code: "disposable-code", state: first.state })}`, {
    headers: { cookie: first.cookies },
  }), config);
  assert.equal(callback.headers.get("location"), `${origin}/join`);
  assert.equal(referralReads, 1);
  assert.deepEqual(registrations, [{ userId: "google:stable-google-subject", referralCode: "CREATOR" }]);
  const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`));
  assert.ok(sessionCookie);
  const sessionResponse = await Auth(new Request(`${origin}/api/auth/session`, {
    // Another Auth.js application may leave an unrelated cookie on this host.
    headers: { cookie: `authjs.session-token=invalid-unrelated-cookie; ${sessionCookie.split(";", 1)[0]}` },
  }), config);
  const session = await sessionResponse.json() as { expires: string; user: { id: string } };
  assert.deepEqual(session.user, { id: "google:stable-google-subject" });
  assert.equal(typeof session.expires, "string");

  const second = await start();
  issueBadNonce = true;
  const rejected = await Auth(new Request(`${origin}/api/auth/callback/google?${new URLSearchParams({ code: "disposable-code", state: second.state })}`, {
    headers: { cookie: second.cookies },
  }), config);
  assert.match(rejected.headers.get("location") ?? "", /^http:\/\/127\.0\.0\.1:3391\/sign-in\?error=/);
  assert.equal(rejected.headers.getSetCookie().some((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`)), false);
  assert.equal(referralReads, 1);
  assert.equal(registrations.length, 1);

  issueBadNonce = false;
  const third = await start();
  const badState = await Auth(new Request(`${origin}/api/auth/callback/google?${new URLSearchParams({ code: "disposable-code", state: "wrong-state" })}`, {
    headers: { cookie: third.cookies },
  }), config);
  assert.match(badState.headers.get("location") ?? "", /^http:\/\/127\.0\.0\.1:3391\/sign-in\?error=/);
  assert.equal(badState.headers.getSetCookie().some((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`)), false);
  assert.equal(referralReads, 1);
  assert.equal(registrations.length, 1);

  const fourth = await start();
  const invalidVerifier = fourth.cookies.split("; ").map((value) =>
    value.startsWith(`${localAuthCookies.pkceCodeVerifier.name}=`)
      ? `${localAuthCookies.pkceCodeVerifier.name}=invalid`
      : value,
  ).join("; ");
  const badPkce = await Auth(new Request(`${origin}/api/auth/callback/google?${new URLSearchParams({ code: "disposable-code", state: fourth.state })}`, {
    headers: { cookie: invalidVerifier },
  }), config);
  assert.match(badPkce.headers.get("location") ?? "", /^http:\/\/127\.0\.0\.1:3391\/sign-in\?error=/);
  assert.equal(badPkce.headers.getSetCookie().some((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`)), false);
  assert.equal(referralReads, 1);
  assert.equal(registrations.length, 1);

  failRegistration = true;
  const fifth = await start();
  const previousErrors = loggedErrors.length;
  const failedRegistration = await Auth(new Request(`${origin}/api/auth/callback/google?${new URLSearchParams({ code: "disposable-code", state: fifth.state })}`, {
    headers: { cookie: fifth.cookies },
  }), config);
  assert.match(failedRegistration.headers.get("location") ?? "", /^http:\/\/127\.0\.0\.1:3391\/sign-in\?error=/);
  assert.equal(failedRegistration.headers.getSetCookie().some((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`)), false);
  assert.equal(referralReads, 2);
  assert.deepEqual(registrations[1], { userId: "google:stable-google-subject", referralCode: "CREATOR" });
  assert.ok(loggedErrors.length > previousErrors);
  assert.doesNotMatch(inspect(loggedErrors.slice(previousErrors), { depth: 8 }), /Private storage failure details/);
});
