import { NextRequest, NextResponse } from "next/server";
import { REFERRAL_COOKIE } from "@/lib/referrals";

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/join", request.url));
  response.cookies.set(REFERRAL_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
