"use client";

import { useState, type FormEvent } from "react";
import type { ReferralSummary } from "@/lib/referrals";
import styles from "./referrals.module.css";

export default function ReferralDashboard({ initialReferrals }: { initialReferrals: ReferralSummary[] }) {
  const [referrals, setReferrals] = useState(initialReferrals);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function mutate(method: "POST" | "PATCH", body: object) {
    setBusy(true); setStatus("");
    try {
      const response = await fetch("/api/admin/referrals", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) { setStatus(data.error || "Something went wrong. Please try again."); return false; }
      setReferrals(data.referrals);
      return true;
    } catch { setStatus("Couldn’t connect. Please try again."); return false; }
    finally { setBusy(false); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("POST", { code, label })) { setLabel(""); setCode(""); setStatus("Link created. It’s ready to share."); }
  }

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setStatus("Link copied."); }
    catch { setStatus("Couldn’t copy automatically. Select and copy the link below."); }
  }

  return <>
    <form className={styles.form} onSubmit={create}>
      <div><h2>Create a link</h2><p>Choose a name and a short code for your creator.</p></div>
      <label>Creator name<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Aisha" maxLength={80} required /></label>
      <label>Referral code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="e.g. AISHA" minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" autoCapitalize="characters" required /></label>
      <p className={styles.help}>3–32 letters, numbers, hyphens or underscores. Codes are unique.</p>
      <button className={styles.primary} disabled={busy} type="submit">{busy ? "Saving…" : "Create link"}</button>
    </form>
    <p className={styles.status} role="status" aria-live="polite">{status}</p>
    <section className={styles.list} aria-labelledby="links-title">
      <div className={styles.listHeading}><div><h2 id="links-title">Your links</h2><p>{referrals.length} {referrals.length === 1 ? "link" : "links"}</p></div></div>
      {referrals.length === 0 ? <p className={styles.empty}>No links yet. Create one above to get started.</p> : referrals.map((referral) => <article className={styles.card} key={referral.code}>
        <div className={styles.cardTitle}><div><h3>{referral.label}</h3><p>{referral.code}</p></div><span className={referral.active ? styles.active : styles.inactive}>{referral.active ? "Active" : "Disabled"}</span></div>
        <div className={styles.stats}><div><strong>{referral.clicks}</strong><span>Clicks</span></div><div><strong>{referral.signups}</strong><span>Signups</span></div><div><strong>{referral.payments}</strong><span>Payments</span></div><div><strong>{referral.profiles}</strong><span>Profiles completed</span></div></div>
        <label className={styles.linkLabel}>Share link<input readOnly value={referral.url} onFocus={(event) => event.currentTarget.select()} /></label>
        <div className={styles.actions}><button type="button" onClick={() => copy(referral.url)}>Copy link</button>{referral.active && <a href={referral.qrUrl} target="_blank" rel="noreferrer">Open QR code</a>}<button type="button" disabled={busy} onClick={async () => { if (await mutate("PATCH", { code: referral.code, active: !referral.active })) setStatus(referral.active ? "Link disabled." : "Link enabled."); }}>{referral.active ? "Disable" : "Enable"}</button></div>
      </article>)}
      <p className={styles.footnote}>Clicks count visits to the invitation link, including QR scans and repeat visits. A signup is counted when a new Google account registers with the invitation; returning members don’t add signups. Payments are captured payments by those members; refunds remove them. These exact counts are private.</p>
    </section>
  </>;
}
