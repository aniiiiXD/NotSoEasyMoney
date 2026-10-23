import test from "node:test";
import assert from "node:assert/strict";
import { billingSettings, formatPaymentAmount } from "../src/lib/billing-config.ts";

test("billing is off by default and has a visible, configurable per-introduction INR price", () => {
  assert.equal(billingSettings({}).enabled, false);
  assert.equal(billingSettings({}).amount, 2000);
  assert.equal(formatPaymentAmount(2000), "₹20.00");
  assert.equal(billingSettings({ DISCOVERY_PAYWALL_ENABLED: "true", DISCOVERY_PRICE_PAISE: "4900" }).amount, 4900);
});
test("a misspelled flag and invalid active pricing fail closed", () => {
  assert.throws(() => billingSettings({ DISCOVERY_PAYWALL_ENABLED: "treu" }));
  for (const amount of ["99", "0", "2000.1", "NaN", "Infinity", "-100", "10000001"]) assert.throws(() => billingSettings({ DISCOVERY_PAYWALL_ENABLED: "true", DISCOVERY_PRICE_PAISE: amount }));
});
test("both API credentials and webhook signing are required; test/live modes are separate", () => {
  const env = { RAZORPAY_KEY_ID: "rzp_test_example", RAZORPAY_KEY_SECRET: "private", RAZORPAY_WEBHOOK_SECRET: "separate" };
  assert.equal(billingSettings(env).configured, true);
  assert.equal(billingSettings({ ...env, RAZORPAY_WEBHOOK_SECRET: "" }).configured, false);
  assert.equal(billingSettings(env).mode, "test");
  assert.equal(billingSettings({ ...env, RAZORPAY_KEY_ID: "rzp_live_example" }).mode, "live");
});
