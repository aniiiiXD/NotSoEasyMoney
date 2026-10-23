import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";
import { getActiveReferral, normalizeReferralCode, recordReferralClick, REFERRAL_COOKIE, REFERRAL_MAX_AGE, signReferralCode, verifyReferralCode } from "@/lib/referrals";

export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await context.params;
  const code = normalizeReferralCode(rawCode);
  if (!code || !process.env.AUTH_SECRET) return NextResponse.redirect(new URL("/sign-in?referral=invalid", request.url));
  if ((await auth())?.user?.id) return NextResponse.redirect(new URL("/join", request.url));
  const referral = await getActiveReferral(getDb(), code);
  if (!referral) return NextResponse.redirect(new URL("/sign-in?referral=invalid", request.url));
  try { await recordReferralClick(getDb(), code); } catch { /* a counting failure must not lose the visit */ }
  const existing = verifyReferralCode(request.cookies.get(REFERRAL_COOKIE)?.value, process.env.AUTH_SECRET);
  const keepFirst = existing && await getActiveReferral(getDb(), existing);
  const response = NextResponse.redirect(new URL("/sign-in", request.url));
  if (!keepFirst) {
    response.cookies.set(REFERRAL_COOKIE, signReferralCode(referral.code, process.env.AUTH_SECRET), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: REFERRAL_MAX_AGE,
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
