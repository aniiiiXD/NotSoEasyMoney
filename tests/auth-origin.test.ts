import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Auth, customFetch, type AuthConfig } from "@auth/core";
import Google from "next-auth/providers/google";
import { decode } from "next-auth/jwt";
import { NextRequest } from "next/server.js";
import { withLocalOrigin } from "../src/lib/auth-request.ts";

const origin = "http://127.0.0.1:3391";
const secret = "a-disposable-test-secret-that-is-long-enough";
const environment: Record<string, string | undefined> = process.env;
const config = {
  secret,
  trustHost: true,
  basePath: "/api/auth",
  providers: [Google({
    clientId: "test-client",
    clientSecret: "test-secret",
    checks: ["pkce", "state"],
    [customFetch]: async (input) => {
      assert.equal(String(input), "https://accounts.google.com/.well-known/openid-configuration");
      return Response.json({
        issuer: "https://accounts.google.com",
        authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
        token_endpoint: "https://oauth2.googleapis.com/token",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    },
  })],
} satisfies AuthConfig;

function cookie(response: Response, name: string) {
  const header = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`));
  assert.ok(header, `missing ${name}`);
  return { header, value: decodeURIComponent(header.slice(name.length + 1).split(";", 1)[0]) };
}

test("loopback OAuth uses the browser origin and preserves its state and PKCE cookies", async () => {
  const previousNodeEnv = environment.NODE_ENV;
  environment.NODE_ENV = "development";
  try {
    // NextRequest intentionally represents the URL as localhost while retaining
    // the browser's 127.0.0.1 Host header, as the Next.js dev server does.
    const csrfRequest = new NextRequest(`${origin}/api/auth/csrf`, { headers: { host: "127.0.0.1:3391" } });
    assert.equal(new URL(csrfRequest.url).hostname, "localhost");
    const csrfResponse = await Auth(withLocalOrigin(csrfRequest), config);
    const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
    const csrfCookie = cookie(csrfResponse, "authjs.csrf-token");
    const form = new URLSearchParams({ csrfToken, callbackUrl: "/join" });
    const request = new NextRequest(`${origin}/api/auth/signin/google`, {
      method: "POST",
      headers: {
        host: "127.0.0.1:3391",
        "content-type": "application/x-www-form-urlencoded",
        cookie: `authjs.csrf-token=${encodeURIComponent(csrfCookie.value)}`,
      },
      body: form,
    });
    const response = await Auth(withLocalOrigin(request), config);
    assert.equal(response.status, 302);
    const location = response.headers.get("location");
    assert.ok(location);
    const redirect = new URL(location);
    assert.equal(redirect.origin, "https://accounts.google.com");
    assert.equal(redirect.searchParams.get("redirect_uri"), `${origin}/api/auth/callback/google`);

    const stateCookie = cookie(response, "authjs.state");
    assert.match(stateCookie.header, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    assert.match(stateCookie.header, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    assert.doesNotMatch(stateCookie.header, /(?:^|;)\s*Domain=/i);
    const state = await decode({ token: stateCookie.value, secret, salt: "authjs.state" });
    assert.equal(state?.provider, "google");
    assert.equal(state?.value, redirect.searchParams.get("state"));
    const verifierCookie = cookie(response, "authjs.pkce.code_verifier");
    const verifier = await decode({ token: verifierCookie.value, secret, salt: "authjs.pkce.code_verifier" });
    assert.equal(typeof verifier?.value, "string");
    const challenge = createHash("sha256").update(verifier!.value as string).digest("base64url");
    assert.equal(redirect.searchParams.get("code_challenge"), challenge);
    assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
  }
});

test("production and non-loopback requests are not rewritten", () => {
  const previousNodeEnv = environment.NODE_ENV;
  try {
    environment.NODE_ENV = "development";
    const external = new NextRequest("https://example.com/api/auth/session", { headers: { host: "example.com" } });
    assert.equal(withLocalOrigin(external), external);
    environment.NODE_ENV = "production";
    const local = new NextRequest(`${origin}/api/auth/session`, { headers: { host: "127.0.0.1:3391" } });
    assert.equal(withLocalOrigin(local), local);
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousNodeEnv;
  }
});
