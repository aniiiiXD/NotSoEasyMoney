// Register/resync this app's webhook in the mode selected by the supplied keys.
// API keys and the webhook secret are never printed.
import { createHmac } from "node:crypto";
import { provisionPaymentWebhook } from "../src/lib/payment-webhook.ts";

const keyId = process.env.RAZORPAY_KEY_ID?.trim();
const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
if (!keyId || !/^rzp_(test|live)_/.test(keyId) || !keySecret || !secret) throw new Error("RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required.");
const origin = new URL(process.env.APP_URL || "https://mystery-match-dating.vercel.app");
if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("APP_URL must be the public HTTPS origin.");
const url = new URL("/api/payments/razorpay/webhook", origin).href;
try {
  // A valid signed, ignored event proves the deployed endpoint has the same secret.
  const body = JSON.stringify({ event: "setup.probe" });
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", secret).update(body).digest("hex") }, body, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Deploy matching payment environment variables first. Webhook probe returned HTTP ${response.status}.`);
  const hook = await provisionPaymentWebhook({ keyId, keySecret, webhookSecret: secret }, origin.href);
  console.log(`Webhook ready: ${hook.id}`);
  console.log(`Mode: ${keyId.startsWith("rzp_live_") ? "LIVE" : "TEST"}; URL: ${url}`);
  console.log("Deployed signing secret verified. Capture, failure, order and refund events configured.");
} catch (error) {
  if (error instanceof Error) console.error(error.message);
  else console.error(`Razorpay webhook setup failed (HTTP ${error?.statusCode || "unknown"}). Check merchant permissions and dashboard settings.`);
  process.exitCode = 1;
}
