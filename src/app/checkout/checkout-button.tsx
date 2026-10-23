"use client";

import Script from "next/script";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../app.module.css";

type PaymentResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayOptions = {
  key: string; amount: number; currency: string; order_id: string; name: string; description: string;
  handler: (response: PaymentResponse) => void;
  modal: { ondismiss: () => void }; retry: { enabled: boolean }; theme: { color: string };
};
type RazorpayInstance = { open: () => void; on: (event: "payment.failed", handler: (response: { error?: { description?: string } }) => void) => void };
declare global { interface Window { Razorpay?: new (options: RazorpayOptions) => RazorpayInstance } }

export default function CheckoutButton({ configured, testMode, amount, price }: { configured: boolean; testMode: boolean; amount: number; price: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const locked = useRef(false);
  const pending = useRef<PaymentResponse | null>(null);
  const [awaitingCapture, setAwaitingCapture] = useState(false);

  function release() { locked.current = false; setBusy(false); }
  function openIntroductions() { router.replace("/discover"); router.refresh(); }
  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not complete your request.");
    return data;
  }
  async function verify(response: PaymentResponse) {
    pending.current = response;
    setMessage("Confirming your payment…"); setError(""); setAwaitingCapture(true);
    try {
      const data = await post("/api/verify-payment", response);
      if (data.success !== true) throw new Error("Could not confirm your payment.");
      if (data.paid) { pending.current = null; setMessage("Payment confirmed. Opening introductions…"); openIntroductions(); }
      else setMessage(`Payment received; confirmation is pending. Please check the status before paying again. Reference: ${data.payment_id}`);
    } catch (error) {
      setMessage(""); setError(`${error instanceof Error ? error.message : "Could not confirm your payment."} Check payment status before paying again.`);
    } finally { release(); }
  }
  async function checkStatus() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage("Checking payment status…");
    try {
      const data = await post("/api/payments/status", {});
      if (data.access) { pending.current = null; openIntroductions(); }
      else {
        if (["failed", "refunded"].includes(data.status)) { pending.current = null; setAwaitingCapture(false); }
        setMessage("No completed payment yet. If you’ve paid, allow a moment for confirmation and check again. Your profile is saved.");
      }
    } catch (error) { setMessage(""); setError(error instanceof Error ? error.message : "Could not check payment status."); }
    finally { release(); }
  }
  async function checkout() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    if (pending.current) { await verify(pending.current); return; }
    let returned = false;
    let failed = false;
    try {
      if (!window.Razorpay) throw new Error("Checkout has not loaded. Refresh and try again.");
      const order = await post("/api/create-order", { amount, currency: "INR" });
      if (order.already_paid) { openIntroductions(); release(); return; }
      if (order.pending) { setAwaitingCapture(true); setMessage("Your earlier payment is awaiting confirmation. Check its status below before paying again."); release(); return; }
      const modal = new window.Razorpay({
        key: order.key_id, amount: order.amount, currency: order.currency, order_id: order.order_id,
        name: "Mystery Match", description: testMode ? "Test: one new introduction" : "One new introduction",
        theme: { color: "#625b81" }, retry: { enabled: false },
        handler(response) { returned = true; void verify(response); },
        modal: { ondismiss() {
          if (!returned) {
            if (!failed) setMessage("Checkout closed. Your profile is saved. If you paid, check payment status below.");
            release();
          }
        } },
      });
      modal.on("payment.failed", (response) => {
        failed = true; setError(response.error?.description || "Payment failed. You can try again."); setMessage(""); release();
      });
      modal.open();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open checkout."); release(); }
  }
  return <>
    {configured && <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setError("Could not load checkout. Check your connection and refresh.")} />}
    {!configured && <p className={styles.notice} role="status">Payments are not available yet. Your profile is saved; please check back later.</p>}
    <div className={styles.paymentActions}>
      <button className={styles.primary} type="button" onClick={() => void checkout()} disabled={!configured || !ready || busy || awaitingCapture}>
        {busy ? "Please wait…" : !ready && configured ? "Loading checkout…" : `Pay ${price}${testMode ? " · test mode" : ""}`}
      </button>
      <button className={styles.secondary} type="button" disabled={!configured || busy} onClick={() => void checkStatus()}>Already paid? Check status</button>
    </div>
    {message && <p className={styles.notice} role="status">{message}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </>;
}
