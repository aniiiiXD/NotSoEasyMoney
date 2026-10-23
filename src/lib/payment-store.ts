import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getDb, withTransaction } from "./db.ts";
import { BillingError, type PaymentMode } from "./billing-config.ts";
import { getOwnProfile } from "./local-matching.ts";
import { hasAnswers } from "./personality.ts";

export type GatewayOrder = { id: string; amount: number | string; currency: string };
export type GatewayPayment = { id: string; order_id: string | null; amount: number | string; currency: string; status: string; captured: boolean; amount_refunded?: number };
export type StoredOrder = {
  order_id: string; user_id: string; key_id: string; mode: PaymentMode; amount: number; currency: string;
  status: "created" | "authorized" | "paid" | "failed" | "refunded"; payment_id: string | null; amount_refunded: number;
};
export type PaymentStore = ReturnType<typeof createPaymentStore>;

export function createPaymentStore(database: () => Pool = getDb) {
  return {
    async hasAccess(userId: string, mode: PaymentMode): Promise<boolean> {
      return Boolean((await database().query("SELECT 1 FROM payment_orders o WHERE user_id = $1 AND mode = $2 AND status = 'paid' AND NOT EXISTS (SELECT 1 FROM paid_introductions i WHERE i.order_id = o.order_id) LIMIT 1", [userId, mode])).rowCount);
    },
    async getOrder(orderId: string, userId?: string): Promise<StoredOrder | null> {
      return (await database().query<StoredOrder>("SELECT * FROM payment_orders WHERE order_id = $1 AND ($2::text IS NULL OR user_id = $2)", [orderId, userId ?? null])).rows[0] ?? null;
    },
    async pendingOrder(userId: string, keyId: string): Promise<StoredOrder | null> {
      return (await database().query<StoredOrder>("SELECT * FROM payment_orders WHERE user_id = $1 AND key_id = $2 AND status IN ('created', 'authorized') ORDER BY created_at DESC LIMIT 1", [userId, keyId])).rows[0] ?? null;
    },
    async createOrder(userId: string, item: { keyId: string; mode: PaymentMode; amount: number; currency: string }, create: (receipt: string) => Promise<GatewayOrder>): Promise<StoredOrder | null> {
      return withTransaction(database(), async (client) => {
        // Serialize checkout starts across tabs/instances and against account deletion.
        if (!(await client.query("SELECT user_id FROM app_users WHERE user_id = $1 FOR UPDATE", [userId])).rowCount) throw new BillingError("Sign in again to continue.", 401);
        if ((await client.query("SELECT 1 FROM payment_orders o WHERE user_id = $1 AND mode = $2 AND status = 'paid' AND NOT EXISTS (SELECT 1 FROM paid_introductions i WHERE i.order_id = o.order_id) LIMIT 1", [userId, item.mode])).rowCount) return null;
        const profile = await getOwnProfile(client, userId);
        if (!profile || !hasAnswers(profile.answers)) throw new BillingError("Finish your profile before payment.", 403);
        const pending = await client.query<StoredOrder>("SELECT * FROM payment_orders WHERE user_id = $1 AND key_id = $2 AND amount = $3 AND status IN ('created', 'authorized') AND created_at > now() - interval '1 hour' ORDER BY created_at DESC LIMIT 1", [userId, item.keyId, item.amount]);
        if (pending.rows[0]) return pending.rows[0];
        const receipt = `mm_${randomUUID().replaceAll("-", "")}`;
        const order = await create(receipt);
        if (!/^order_[a-zA-Z0-9]+$/.test(order.id) || Number(order.amount) !== item.amount || order.currency !== item.currency) throw new Error("Unexpected order response.");
        return (await client.query<StoredOrder>("INSERT INTO payment_orders (order_id, user_id, receipt, key_id, mode, amount, currency) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [order.id, userId, receipt, item.keyId, item.mode, item.amount, item.currency])).rows[0];
      });
    },
    async applyPayment(payment: GatewayPayment, mode: PaymentMode): Promise<StoredOrder | null> {
      return withTransaction(database(), async (client) => {
        const order = (await client.query<StoredOrder>("SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE", [payment.order_id])).rows[0];
        if (!order) return null;
        if (order.mode !== mode || Number(payment.amount) !== order.amount || payment.currency !== order.currency) throw new BillingError("Payment details do not match this checkout.", 400);
        const refunded = Math.max(order.amount_refunded, payment.amount_refunded ?? 0);
        // Refunds are terminal. Delayed authorized/failed events cannot undo a capture.
        const status = refunded > 0 || order.status === "refunded" || payment.status === "refunded" ? "refunded"
          : order.status === "paid" || (payment.status === "captured" && payment.captured) ? "paid"
          : payment.status === "authorized" ? "authorized" : payment.status === "failed" ? "failed" : order.status;
        const paymentId = order.status === "paid" || order.status === "refunded" ? order.payment_id
          : ["captured", "authorized", "refunded"].includes(payment.status) ? payment.id : order.payment_id;
        return (await client.query<StoredOrder>("UPDATE payment_orders SET status = $2, payment_id = $3, amount_refunded = $4, updated_at = now() WHERE order_id = $1 RETURNING *", [order.order_id, status, paymentId, refunded])).rows[0];
      });
    },
  };
}
