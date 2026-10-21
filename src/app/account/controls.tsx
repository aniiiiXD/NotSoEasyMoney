"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";
import styles from "../admin/referrals/referrals.module.css";
export default function AccountControls() {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      if (!response.ok) throw new Error();
      await signOut({ callbackUrl: "/" });
    } catch { setError("Could not delete your account. Please try again."); setBusy(false); }
  }
  return <section className={styles.form}><h2>Delete account</h2><p>This permanently removes your profile, answers, referral attribution, support tickets, matches and conversations, including messages visible to your matches. You can sign up again later.</p>{!confirm ? <button className={styles.primary} type="button" onClick={() => setConfirm(true)}>Delete my account</button> : <><p>Are you sure? This cannot be undone.</p><div className={styles.actions}><button type="button" disabled={busy} onClick={remove}>{busy ? "Deleting…" : "Yes, permanently delete"}</button><button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div></>}<p role="alert">{error}</p></section>;
}
