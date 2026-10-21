import { test } from "node:test";
import assert from "node:assert/strict";
import { Auth, type AuthConfig } from "@auth/core";
import Credentials from "next-auth/providers/credentials";
import { authorizeDemo, isLoopbackHost, localDemoEnabled } from "../src/app/sign-in/demo.ts";
import { authCallbacks, localAuthCookies } from "../src/lib/auth-config.ts";

const environment: Record<string, string | undefined> = process.env;

function inEnvironment(nodeEnv: string, secret: string | undefined, run: () => void) {
  const previousEnv = environment.NODE_ENV;
  const previousSecret = environment.AUTH_SECRET;
  environment.NODE_ENV = nodeEnv;
  if (secret === undefined) delete environment.AUTH_SECRET; else environment.AUTH_SECRET = secret;
  try { run(); }
  finally {
    if (previousEnv === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete environment.AUTH_SECRET; else environment.AUTH_SECRET = previousSecret;
  }
}

function request(url: string, host?: string) {
  return new Request(url, { headers: host ? { host } : {} });
}

test("local demo issues a fresh demo identity for every login", () => {
  inEnvironment("development", "local-test-secret", () => {
    assert.equal(localDemoEnabled(), true);
    const first = authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "127.0.0.1:3000"));
    const second = authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "127.0.0.1:3000"));
    assert.match(first?.id ?? "", /^demo:[0-9a-f-]{36}$/);
    assert.match(second?.id ?? "", /^demo:[0-9a-f-]{36}$/);
    assert.notEqual(first?.id, second?.id);
  });
});

test("demo refuses production, missing secrets, and non-loopback hosts", () => {
  const local = request("http://localhost:3000/api/auth/callback/demo", "localhost:3000");
  inEnvironment("production", "local-test-secret", () => assert.equal(authorizeDemo(local), null));
  inEnvironment("development", undefined, () => assert.equal(authorizeDemo(local), null));
  inEnvironment("development", "local-test-secret", () => {
    assert.equal(authorizeDemo(request("http://localhost:3000/api/auth/callback/demo", "example.com")), null);
    assert.equal(authorizeDemo(request("https://example.com/api/auth/callback/demo", "localhost:3000")), null);
    assert.equal(authorizeDemo(request("http://localhost:3000/api/auth/callback/demo")), null);
    for (const host of ["localhost.evil.test", "127.0.0.1.evil.test", "evil.test:3000", "localhost:3000@evil.test"]) {
      assert.equal(isLoopbackHost(host), false);
    }
    for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
      assert.equal(isLoopbackHost(host), true);
    }
  });
});

test("namespaced development cookies preserve demo login and ignore other apps’ cookies", async () => {
  const previousEnv = environment.NODE_ENV;
  const previousSecret = environment.AUTH_SECRET;
  environment.NODE_ENV = "development";
  environment.AUTH_SECRET = "disposable-test-secret-long-enough-for-this-test";
  try {
    const origin = "http://127.0.0.1:3391";
    const config = {
      secret: environment.AUTH_SECRET, trustHost: true, basePath: "/api/auth", cookies: localAuthCookies,
      providers: [Credentials({ id: "demo", credentials: {}, authorize(_credentials, request) { return authorizeDemo(request); } })],
      session: { strategy: "jwt" }, callbacks: authCallbacks,
      logger: { error() {}, warn() {}, debug() {} },
    } satisfies AuthConfig;
    const csrf = await Auth(new Request(`${origin}/api/auth/csrf`), config);
    const { csrfToken } = await csrf.json() as { csrfToken: string };
    const csrfCookie = csrf.headers.getSetCookie().find((value) => value.startsWith(`${localAuthCookies.csrfToken.name}=`));
    assert.ok(csrfCookie);
    const login = await Auth(new Request(`${origin}/api/auth/callback/demo`, {
      method: "POST",
      headers: { host: "127.0.0.1:3391", "content-type": "application/x-www-form-urlencoded", cookie: csrfCookie.split(";", 1)[0] },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/join" }),
    }), config);
    assert.equal(login.headers.get("location"), `${origin}/join`);
    const sessionCookie = login.headers.getSetCookie().find((value) => value.startsWith(`${localAuthCookies.sessionToken.name}=`));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    assert.match(sessionCookie, /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    assert.doesNotMatch(sessionCookie, /(?:^|;)\s*Domain=/i);
    const session = await Auth(new Request(`${origin}/api/auth/session`, {
      headers: { cookie: `authjs.session-token=unrelated; ${sessionCookie.split(";", 1)[0]}` },
    }), config);
    const data = await session.json() as { user: { id: string } };
    assert.match(data.user.id, /^demo:[0-9a-f-]{36}$/);
  } finally {
    if (previousEnv === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previousEnv;
    if (previousSecret === undefined) delete environment.AUTH_SECRET; else environment.AUTH_SECRET = previousSecret;
  }
});
