"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Candidate } from "@/lib/matching";
import styles from "../app.module.css";

type ChoiceResult = { status: "matched" | "pending"; roomId?: string };
type PendingChoice = { candidateId: string; decision: "like" | "pass" };

export default function Discovery({ alias, initial, localTesting, demoMode, logout }: { alias: string; initial: Candidate[]; localTesting: boolean; demoMode: boolean; logout: () => Promise<void> }) {
  const [candidates, setCandidates] = useState(initial);
  const [busy, setBusy] = useState<PendingChoice | null>(null);
  const [results, setResults] = useState<Record<string, ChoiceResult>>({});
  const [focusedResult, setFocusedResult] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<{ candidateId: string; message: string } | null>(null);

  useEffect(() => {
    if (focusedResult) document.getElementById(`result-${focusedResult}`)?.focus();
  }, [focusedResult]);

  function dismiss(candidateId: string) {
    setCandidates((previous) => previous.filter((candidate) => candidate.candidateId !== candidateId));
    setFocusedResult("");
  }

  async function choose(candidateId: string, decision: "like" | "pass") {
    setBusy({ candidateId, decision });
    setError(null);
    setNotice("");
    try {
      const response = await fetch("/api/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId, decision }) });
      const body = await response.json();
      if (!response.ok) { setError({ candidateId, message: body.error ?? "Could not save your choice." }); return; }
      if (body.status === "matched" || body.status === "pending") {
        setResults((previous) => ({ ...previous, [candidateId]: { status: body.status, roomId: typeof body.roomId === "string" ? body.roomId : undefined } }));
        setFocusedResult(candidateId);
      } else {
        dismiss(candidateId);
        setNotice("Introduction passed.");
      }
    } catch {
      setError({ candidateId, message: "Could not connect. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerTop}><Link href="/" className={styles.wordmark}>Mystery Match</Link><form action={logout}><button className={styles.signOut} type="submit">Sign out</button></form></div>
      <nav className={styles.appNav} aria-label="Main navigation"><Link href="/discover" aria-current="page">Discover</Link><Link href="/chat">Conversations</Link><Link href="/join?edit=1">Preferences</Link></nav>
    </header>
    <main className={styles.discovery}>
      <div className={styles.discoveryHeader}><p className={styles.kicker}>Your introductions</p><h1>Good to see you, {alias}.</h1><p>Get to know someone, one conversation at a time.</p></div>
      {demoMode && <div className={styles.demoNote}><p><strong>Local demo.</strong> These profiles are fictional. Say hello to try a match and a scripted conversation.</p><Link href="/demo/analytics">See sample analytics →</Link></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {candidates.length > 0 ? <div className={styles.candidateGrid}>{candidates.map((candidate) => {
        const result = results[candidate.candidateId];
        if (result) return <article className={styles.candidate} id={`result-${candidate.candidateId}`} key={candidate.candidateId} tabIndex={-1} role="status">
          <p className={styles.candidateLabel}>{result.status === "matched" ? "It’s mutual" : "Interest saved"}</p>
          <h2>{result.status === "matched" ? "Your conversation is ready." : "You’ve said hello."}</h2>
          <p className={styles.candidateDescription}>{result.status === "matched" ? `You and ${candidate.blindAlias} can start talking.` : "If they choose you too, you’ll both get a conversation."}</p>
          <div className={styles.resultActions}>
            {result.status === "matched" && <Link className={styles.primary} href={result.roomId ? `/chat/${encodeURIComponent(result.roomId)}` : "/chat"}>Open conversation</Link>}
            <button className={styles.secondary} type="button" onClick={() => dismiss(candidate.candidateId)}>Keep browsing</button>
          </div>
        </article>;
        return <article className={styles.candidate} key={candidate.candidateId} aria-busy={busy?.candidateId === candidate.candidateId}>
          <p className={styles.candidateLabel}>{demoMode ? "Sample introduction" : "A new introduction"}</p><h2>{candidate.blindAlias}</h2><p className={styles.candidateDescription}>{candidate.explanation}</p>
          {error?.candidateId === candidate.candidateId && <p className={styles.candidateError} role="alert">{error.message}</p>}
          <div className={styles.candidateActions}>
            <button type="button" disabled={!!busy} onClick={() => choose(candidate.candidateId, "pass")}>{busy?.candidateId === candidate.candidateId && busy.decision === "pass" ? "Passing…" : "Pass"}</button>
            <button type="button" disabled={!!busy} onClick={() => choose(candidate.candidateId, "like")}>{busy?.candidateId === candidate.candidateId && busy.decision === "like" ? "Sending…" : "Say hello"}</button>
          </div>
        </article>;
      })}</div> : <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><span /><span /></div><h2>{demoMode ? "You’ve seen the sample introductions." : "No introductions just yet."}</h2><p>{demoMode ? "Visit your conversations, or sign out and start a fresh demo to see them again." : <>When someone with overlapping preferences joins, you’ll find them here.{localTesting ? " To try a match locally, create a second account in a private browser window." : ""}</>}</p><Link className={styles.secondary} href={demoMode ? "/chat" : "/join?edit=1"}>{demoMode ? "Open conversations" : "Review your preferences"}</Link></div>}
    </main>
  </div>;
}
