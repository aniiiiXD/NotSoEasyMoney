import { billingSettings } from "./billing-config.ts";
import { createPaymentStore } from "./payment-store.ts";

export async function discoveryAccess(userId: string) {
  const settings = billingSettings();
  const allowed = !settings.enabled || await createPaymentStore().hasAccess(userId, settings.mode);
  return { ...settings, allowed };
}

