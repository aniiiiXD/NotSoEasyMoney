import QRCode from "qrcode";
import { getDb } from "@/lib/db";
import { getActiveReferral, normalizeReferralCode, referralUrl } from "@/lib/referrals";

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  const { code: input } = await context.params;
  const referral = await getActiveReferral(getDb(), normalizeReferralCode(input));
  if (!referral) return new Response("Referral code not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const png = await QRCode.toBuffer(referralUrl(referral.code), { width: 768, margin: 3, errorCorrectionLevel: "M" });
  return new Response(new Uint8Array(png), { headers: {
    "Content-Type": "image/png", "Content-Disposition": `inline; filename="mystery-match-${referral.code}.png"`,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
  } });
}
