"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage, RoomSummary } from "@/lib/chat";
import styles from "./chat.module.css";
import appStyles from "../app.module.css";

type SelectedRoom = { id: string; alias: string; messages: ChatMessage[] };

export default function ChatClient({ initialRooms, selected, logout, demoMode }: {
  initialRooms: RoomSummary[];
  selected: SelectedRoom | null;
  logout: () => Promise<void>;
  demoMode: boolean;
}) {
  const router = useRouter();
  const [rooms, setRooms] = useState(initialRooms);
  const [messages, setMessages] = useState(selected?.messages ?? []);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const messageList = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const keepAtBottom = useRef(true);
  const messageVersion = useRef(0);
  const selectedId = selected?.id;

  useEffect(() => {
    let alive = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      const versionAtStart = messageVersion.current;
      try {
        const roomResponse = await fetch("/api/rooms", { cache: "no-store" });
        if (roomResponse.ok && alive) setRooms((await roomResponse.json()).rooms);
        if (!selectedId) return;
        const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/messages`, { cache: "no-store" });
        if (!alive) return;
        if (response.status === 404 || response.status === 401) {
          setMessages([]); setUnavailable(true); return;
        }
        if (response.ok) {
          const data = await response.json();
          // A poll started before a successful send may contain an older
          // snapshot. Don't let it erase a message already shown to the user.
          if (alive && versionAtStart === messageVersion.current) setMessages(data.messages);
        }
      } catch { /* The next poll retries; sending errors are shown separately. */ }
      finally { polling = false; }
    };
    const interval = window.setInterval(refresh, 5000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [selectedId]);

  useEffect(() => {
    const panel = messageList.current;
    if (panel && keepAtBottom.current) panel.scrollTop = panel.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const panel = messageList.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => {
      if (keepAtBottom.current) panel.scrollTop = panel.scrollHeight;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [selectedId]);

  useEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }, [text]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !text.trim() || text.trim().length > 2000 || sending || unavailable) return;
    const submittedText = text;
    const restoreDraft = () => setText((current) => current ? `${submittedText}\n${current}` : submittedText);
    setSending(true); setError("");
    setText("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: submittedText }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404 || response.status === 401) { setMessages([]); setUnavailable(true); }
        else restoreDraft();
        setError(result.error || "Couldn’t send your message. Please try again.");
      } else {
        messageVersion.current += 1;
        keepAtBottom.current = true;
        const added: ChatMessage[] = result.sampleReply ? [result.message, result.sampleReply] : [result.message];
        setMessages((current) => [...current, ...added.filter((message) => !current.some((existing) => existing.id === message.id))]);
      }
    } catch { restoreDraft(); setError("Couldn’t connect. Your message is ready to retry."); }
    finally { setSending(false); }
  }

  function handleComposerKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // Keep the return key available for new lines on touch keyboards.
    if (window.matchMedia("(min-width: 760px) and (hover: hover) and (pointer: fine)").matches) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function block() {
    if (!selectedId || blocking || !window.confirm("Block this person? You will both lose access to this conversation.")) return;
    setBlocking(true); setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/block`, { method: "POST" });
      if (!response.ok) { setError("Couldn’t block this person. Please try again."); return; }
      router.push("/chat");
      router.refresh();
    } catch { setError("Couldn’t connect. Please try again."); }
    finally { setBlocking(false); }
  }

  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !reportReason || reporting) return;
    setReporting(true); setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/report`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: reportReason }),
      });
      if (!response.ok) { setError("Couldn’t submit your report. Please try again."); return; }
      router.push("/chat?reported=1");
      router.refresh();
    } catch { setError("Couldn’t connect. Please try again."); }
    finally { setReporting(false); }
  }

  return <main className={`${styles.page} ${selected ? styles.selectedPage : ""}`}>
    <header className={`${appStyles.header} ${styles.globalHeader}`}>
      <div className={appStyles.headerTop}><Link href="/" className={appStyles.wordmark}><span className="brand-mark" aria-hidden="true" />Mystery Match</Link><form action={logout}><button className={appStyles.signOut} type="submit">Sign out</button></form></div>
      <nav className={appStyles.appNav} aria-label="Main navigation"><Link href="/discover">Discover</Link><Link href="/chat" aria-current="page">Conversations</Link><Link href="/join?edit=1">Preferences</Link></nav>
    </header>
    <div className={styles.content}>
      <div className={styles.heading}><p>YOUR CONNECTIONS</p><h1>Conversations</h1><span>A little space to get to know each other.</span></div>
      {demoMode && <div className={`${appStyles.demoNote} ${styles.demoNote}`}><p><strong>Local demo.</strong> These conversations are simulated with scripted replies.</p><Link href="/demo/analytics">See sample analytics →</Link></div>}
      <section className={styles.workspace} aria-label="Conversations">
        <aside className={`${styles.sidebar} ${selected ? styles.sidebarSelected : ""}`}>
          <div className={styles.sidebarTitle}><h2>Your matches</h2><span>{rooms.length}</span></div>
          <p className={styles.sidebarSubtitle}>{rooms.length ? "Choose a conversation to say hello." : "Your matches will appear here."}</p>
          <div className={styles.roomList}>
            {rooms.length ? rooms.map((room) => <Link key={room.id} href={`/chat/${encodeURIComponent(room.id)}`} className={`${styles.roomLink} ${selectedId === room.id ? styles.selectedRoom : ""}`} aria-current={selectedId === room.id ? "page" : undefined}>
              <span className={styles.avatar} aria-hidden="true">{room.alias.slice(0, 1).toUpperCase()}</span>
              <span className={styles.roomDetails}><strong>{room.alias}</strong><small>{room.lastMessageAt ? "Continue your conversation" : "New conversation · Say hello"}</small></span><span className={styles.roomArrow} aria-hidden="true">→</span>
            </Link>) : <p className={styles.noRooms}>When you both say yes, your conversation will show up here.</p>}
          </div>
          <Link className={styles.discover} href="/discover">Explore connections <span aria-hidden="true">→</span></Link>
        </aside>
        <div className={`${styles.conversation} ${selected ? styles.conversationSelected : ""}`}>
          {selected ? <>
            <div className={styles.conversationHeader}>
              <Link href="/chat" className={styles.back} aria-label="Back to conversations">←</Link>
              <span className={styles.avatar} aria-hidden="true">{selected.alias.slice(0, 1).toUpperCase()}</span>
              <div className={styles.person}><h1>{selected.alias}</h1><small>{demoMode ? "Sample chat · scripted replies" : "Get to know each other"}</small></div>
              {!demoMode && <button type="button" className={styles.block} onClick={() => setReportOpen((open) => !open)} disabled={unavailable}>Report</button>}
              <button type="button" className={styles.block} onClick={block} disabled={blocking || unavailable}>Block</button>
            </div>
            {reportOpen && !unavailable && <form onSubmit={report} className={styles.reportForm}>
              <label htmlFor="report-reason">Why are you reporting this person?</label>
              <select id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} required>
                <option value="">Choose a reason</option>
                <option value="harassment">Harassment or threatening behavior</option>
                <option value="sexual_content">Unwanted sexual content</option>
                <option value="scam">Scam or impersonation</option>
                <option value="underage">May be under 18</option>
                <option value="other">Something else</option>
              </select>
              <p>Submitting blocks this person and closes the conversation for both of you.</p>
              <button type="submit" disabled={!reportReason || reporting}>{reporting ? "Submitting…" : "Report and block"}</button>
              <button type="button" onClick={() => setReportOpen(false)}>Cancel</button>
            </form>}
            <div ref={messageList} className={styles.messageList} role="log" aria-live="polite" aria-label="Messages" onScroll={(event) => {
              const panel = event.currentTarget;
              keepAtBottom.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 96;
            }}>
              {unavailable ? <div className={styles.empty}><h2>Conversation unavailable.</h2><p>This conversation is no longer available.</p><Link href="/chat">Back to conversations <span aria-hidden="true">→</span></Link></div> : messages.length ? messages.map((message) => <div key={message.id} className={`${styles.bubble} ${message.mine ? styles.mine : styles.theirs}`}><span className={styles.srOnly}>{message.mine ? "You" : selected.alias}: </span><p>{message.body}</p></div>) : <div className={styles.empty}><p className={styles.emptyLabel}>A NEW CONVERSATION</p><h2>Start with a hello.</h2><p>Take your time getting to know each other.</p></div>}
            </div>
            {!unavailable && <form onSubmit={send} className={styles.composer}>
              {error && <p className={styles.sendError} role="alert">{error}</p>}
              {text.trim().length > 2000 && <p className={styles.sendError} role="alert">Please shorten your message to 2,000 characters.</p>}
              <div><label htmlFor="message" className={styles.srOnly}>Your message</label><textarea ref={composer} id="message" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleComposerKey} placeholder="Write a message..." rows={1} maxLength={2000} /><button type="submit" disabled={!text.trim() || text.trim().length > 2000 || sending}>{sending ? "Sending…" : "Send"}</button></div>
              <p className={styles.composerHint}>Be kind. Take your time. <span>Enter to send · Shift + Enter for a new line</span></p>
            </form>}
          </> : <div className={styles.empty}><p className={styles.emptyLabel}>YOUR CONVERSATIONS</p><h2>Good things start<br />with a hello.</h2><p>{rooms.length ? "Pick a conversation to say hello." : "When you make a match, your conversations will be waiting here."}</p><Link href="/discover">Explore connections <span aria-hidden="true">→</span></Link></div>}
        </div>
      </section>
    </div>
  </main>;
}
