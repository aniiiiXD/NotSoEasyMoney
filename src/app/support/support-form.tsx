"use client";
import { useState, type FormEvent } from "react";
import styles from "../admin/referrals/referrals.module.css";
export default function SupportForm() {
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/support", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: data.get("email"), message: data.get("message") }) });
      const result = await response.json(); if (!response.ok) { setStatus(result.error ?? "Could not send your ticket."); return; }
      form.reset(); setStatus("Ticket sent. We’ll reply to the email you provided.");
    } catch { setStatus("Could not send your ticket. Please try again."); } finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}><label>Email for a reply<input name="email" type="email" required maxLength={254} /></label><label>How can we help?<textarea name="message" required minLength={10} maxLength={2000} rows={6} style={{ border: "1px solid #deddd7", borderRadius: 6, padding: 12, fontSize: 16, width: "100%" }} /></label><button className={styles.primary} disabled={busy}>{busy ? "Sending…" : "Send ticket"}</button><p role="status">{status}</p></form>;
}
