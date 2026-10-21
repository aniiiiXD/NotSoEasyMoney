"use client";

import { useState } from "react";
import styles from "../analytics.module.css";

export function ConsentControls({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updateConsent(next: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/analytics/consent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error("Could not save");
      setEnabled(next);
      setMessage(next ? "Analytics is on." : "Analytics is off and your events have been deleted.");
    } catch {
      setMessage("We couldn’t save that choice. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.controls}>
      <p>Analytics is currently {enabled ? "on" : "off"}.</p>
      <button type="button" disabled={busy} onClick={() => updateConsent(!enabled)} className={styles.button}>
        {busy ? "Saving…" : enabled ? "Turn analytics off" : "Turn analytics on"}
      </button>
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </div>
  );
}
