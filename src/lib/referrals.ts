import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import { withTransaction } from "./db.ts";

export const REFERRAL_COOKIE = "mystery-match-referral";
export const REFERRAL_MAX_AGE = 30 * 24 * 60 * 60;
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeReferralCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`referral:${payload}`).digest("hex");
}

export function signReferralCode(code: string, secret: string, now = Date.now()): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized || !secret) throw new Error("A valid referral code and signing secret are required.");
  const payload = `${normalized}.${Math.floor(now / 1000) + REFERRAL_MAX_AGE}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyReferralCode(value: string | undefined, secret: string | undefined, now = Date.now()): string | null {
  if (!value || !secret || value.length > 150) return null;
  const [code, expires, mac, extra] = value.split(".");
  if (extra !== undefined || !code || !expires || !mac || normalizeReferralCode(code) !== code || !/^\d{1,12}$/.test(expires) || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const expiry = Number(expires);
  const currentTime = Math.floor(now / 1000);
  if (expiry <= currentTime || expiry > currentTime + REFERRAL_MAX_AGE) return null;
  const expected = Buffer.from(signature(`${code}.${expires}`, secret), "hex");
  const actual = Buffer.from(mac, "hex");
  return timingSafeEqual(expected, actual) ? code : null;
}

export async function getActiveReferral(db: Pool, code: string | null): Promise<{ code: string; label: string } | null> {
  if (!code || normalizeReferralCode(code) !== code) return null;
  const { rows } = await db.query<{ code: string; label: string }>(
    "SELECT code, label FROM referral_codes WHERE code = $1 AND active = true", [code],
  );
  return rows[0] ?? null;
}

/** Claim at most one referral when the stable Google identity is first seen. */
export async function registerGoogleAccount(db: Pool, userId: string, code: string | null): Promise<boolean> {
  if (!userId.startsWith("google:") || userId.length <= 7) throw new Error("A Google identity is required.");
  return withTransaction(db, async (client) => {
    const account = await client.query("INSERT INTO app_users (user_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING user_id", [userId]);
    if (!account.rowCount) return false;
    if (code && normalizeReferralCode(code) === code) {
      // Recheck activity at registration; a code can be disabled while OAuth is in progress.
      await client.query(`INSERT INTO referral_attributions (user_id, code)
        SELECT $1, code FROM referral_codes WHERE code = $2 AND active = true`, [userId, code]);
    }
    return true;
  });
}

export function referralUrl(code: string): string {
  const normalized = normalizeReferralCode(code);
  if (!normalized) throw new Error("Invalid referral code.");
  const origin = new URL(process.env.APP_URL || "https://mystery-match-ani.vercel.app");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if ((origin.protocol !== "https:" && !(origin.protocol === "http:" && loopback)) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("APP_URL must be an HTTPS origin (or a local HTTP origin for testing).");
  }
  return new URL(`/r/${normalized}`, origin).toString();
}
