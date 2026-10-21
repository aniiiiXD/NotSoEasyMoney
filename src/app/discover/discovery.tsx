"use client";

import { useState } from "react";
import Link from "next/link";
import type { Candidate } from "@/lib/matching";
import styles from "../app.module.css";

export default function Discovery({ alias, initial, localTesting, demoMode, logout }: { alias: string; initial: Candidate[]; localTesting: boolean; demoMode: boolean; logout: () => Promise<void> }) {
  const [candidates, setCandidates] = useState(initial);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function choose(candidateId: string, decision: "like" | "pass") {
    setBusy(candidateId); setError(""); setNotice("");
    try {
      const response = await fetch("/api/candidates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ candidateId, decision }) });
      const body = await response.json();
      if (!response.ok) { setError(body.error ?? "Could not save your choice."); return; }
      setCandidates((previous) => previous.filter((candidate) => candidate.candidateId !== candidateId));
      if (body.status === "matched") setNotice("It’s mutual. Your conversation is ready.");
      else if (decision === "like") setNotice("Interest saved. If they choose you too, you’ll both get a conversation.");
      else setNotice("Introduction passed.");
    } catch {
      setError("Could not connect. Please try again.");
    } finally { setBusy(""); }
  }

  return <div className={styles.page}>
    <header className={styles.header}>
      <div className={styles.headerTop}><Link href="/" className={styles.wordmark}>Mystery Match</Link><form action={logout}><button className={styles.signOut} type="submit">Sign out</button></form></div>
      <nav className={styles.appNav} aria-label="Main navigation"><Link href="/discover" aria-current="page">Discover</Link><Link href="/chat">Conversations</Link><Link href="/join?edit=1">Preferences</Link></nav>
    </header>
    <main className={styles.discovery}>
      <div className={styles.discoveryHeader}><p className={styles.kicker}>Your introductions</p><h1>Good to see you, {alias}.</h1><p>Get to know someone, one conversation at a time.</p></div>
      {demoMode && <div className={styles.demoNote}><p><strong>Local demo.</strong> These profiles are fictional. Say hello to try a match and a scripted conversation.</p><Link href="/demo/analytics">See sample analytics →</Link></div>}
      {notice && <p className={styles.notice} role="status">{notice} {notice.startsWith("It’s mutual") && <Link href="/chat">Open conversations</Link>}</p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {candidates.length > 0 ? <div className={styles.candidateGrid}>{candidates.map((candidate) => <article className={styles.candidate} key={candidate.candidateId}><p className={styles.candidateLabel}>{demoMode ? "Sample introduction" : "A new introduction"}</p><h2>{candidate.blindAlias}</h2><p className={styles.candidateDescription}>{candidate.explanation}</p><div className={styles.candidateActions}><button type="button" disabled={!!busy} onClick={() => choose(candidate.candidateId, "pass")}>Pass</button><button type="button" disabled={!!busy} onClick={() => choose(candidate.candidateId, "like")}>Say hello</button></div></article>)}</div> : <div className={styles.empty}><div className={styles.emptyMark} aria-hidden="true"><span /><span /></div><h2>{demoMode ? "You’ve seen the sample introductions." : "No introductions just yet."}</h2><p>{demoMode ? "Visit your conversations, or sign out and start a fresh demo to see them again." : <>When someone with overlapping preferences joins, you’ll find them here.{localTesting ? " To try a match locally, create a second account in a private browser window." : ""}</>}</p><Link className={styles.secondary} href={demoMode ? "/chat" : "/join?edit=1"}>{demoMode ? "Open conversations" : "Review your preferences"}</Link></div>}
    </main>
  </div>;
}
