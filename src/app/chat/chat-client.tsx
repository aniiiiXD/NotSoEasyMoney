"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const selectedId = selected?.id;

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const roomResponse = await fetch("/api/rooms", { cache: "no-store" });
        if (roomResponse.ok && alive) setRooms((await roomResponse.json()).rooms);
        if (!selectedId) return;
        const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/messages`, { cache: "no-store" });
        if (!alive) return;
        if (response.status === 404 || response.status === 401) {
          setMessages([]); setUnavailable(true); return;
        }
        if (response.ok) { const data = await response.json(); if (alive) setMessages(data.messages); }
      } catch { /* The next poll retries; sending errors are shown separately. */ }
    };
    const interval = window.setInterval(refresh, 5000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [selectedId]);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !text.trim() || sending || unavailable) return;
    setSending(true); setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedId)}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 404 || response.status === 401) { setMessages([]); setUnavailable(true); }
        setError(result.error || "Couldn’t send your message. Please try again.");
      } else {
        setText("");
        const added: ChatMessage[] = result.sampleReply ? [result.message, result.sampleReply] : [result.message];
        setMessages((current) => [...current, ...added.filter((message) => !current.some((existing) => existing.id === message.id))]);
      }
    } catch { setError("Couldn’t connect. Please try again."); }
    finally { setSending(false); }
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

  return <main className={styles.page}>
    <header className={appStyles.header}>
      <div className={appStyles.headerTop}><Link href="/" className={appStyles.wordmark}>Mystery Match</Link><form action={logout}><button className={appStyles.signOut} type="submit">Sign out</button></form></div>
      <nav className={appStyles.appNav} aria-label="Main navigation"><Link href="/discover">Discover</Link><Link href="/chat" aria-current="page">Conversations</Link><Link href="/join?edit=1">Preferences</Link></nav>
    </header>
    <div className={styles.content}>
      <div className={styles.heading}><p>YOUR CONNECTIONS</p><h1>Conversations</h1><span>A little space to get to know each other.</span></div>
      {demoMode && <div className={appStyles.demoNote}><p><strong>Local demo.</strong> These conversations are simulated with scripted replies.</p><Link href="/demo/analytics">See sample analytics →</Link></div>}
      <section className={styles.workspace} aria-label="Conversations">
        <aside className={`${styles.sidebar} ${selected ? styles.sidebarSelected : ""}`}>
          <div className={styles.sidebarTitle}><h2>Your matches</h2><span>{rooms.length}</span></div>
          <p className={styles.sidebarSubtitle}>Your matches will appear here.</p>
          <div className={styles.roomList}>
            {rooms.length ? rooms.map((room) => <Link key={room.id} href={`/chat/${encodeURIComponent(room.id)}`} className={`${styles.roomLink} ${selectedId === room.id ? styles.selectedRoom : ""}`} aria-current={selectedId === room.id ? "page" : undefined}>
              <span className={styles.avatar} aria-hidden="true">{room.alias.slice(0, 1).toUpperCase()}</span>
              <span className={styles.roomDetails}><strong>{room.alias}</strong><small>{room.lastMessageAt ? "Continue your conversation" : "Say hello"}</small></span><span className={styles.roomArrow} aria-hidden="true">→</span>
            </Link>) : <p className={styles.noRooms}>When you both say yes, your conversation will show up here.</p>}
          </div>
          <Link className={styles.discover} href="/discover">Explore connections <span aria-hidden="true">→</span></Link>
        </aside>
        <div className={`${styles.conversation} ${selected ? styles.conversationSelected : ""}`}>
          {selected ? <>
            <div className={styles.conversationHeader}>
              <Link href="/chat" className={styles.back} aria-label="Back to conversations">←</Link>
              <span className={styles.avatar} aria-hidden="true">{selected.alias.slice(0, 1).toUpperCase()}</span>
              <div className={styles.person}><strong>{selected.alias}</strong><small>Get to know each other</small></div>
              <button type="button" className={styles.block} onClick={block} disabled={blocking || unavailable}>Block</button>
            </div>
            <div className={styles.messageList} aria-live="polite" aria-label="Messages">
              {unavailable ? <div className={styles.empty}><h2>Conversation unavailable.</h2><p>This conversation is no longer available.</p><Link href="/chat">Back to conversations <span aria-hidden="true">→</span></Link></div> : messages.length ? messages.map((message) => <div key={message.id} className={`${styles.bubble} ${message.mine ? styles.mine : styles.theirs}`}><p>{message.body}</p></div>) : <div className={styles.empty}><p className={styles.emptyLabel}>A NEW CONVERSATION</p><h2>Start with a hello.</h2><p>Take your time getting to know each other.</p></div>}
              <div ref={bottom} />
            </div>
            {!unavailable && <form onSubmit={send} className={styles.composer}>
              {error && <p className={styles.sendError} role="alert">{error}</p>}
              <div><label htmlFor="message" className={styles.srOnly}>Your message</label><textarea id="message" value={text} onChange={(event) => setText(event.target.value)} placeholder="Write a message..." rows={1} maxLength={2000} /><button type="submit" disabled={!text.trim() || sending}>Send</button></div>
              <p>Be kind. Take your time.</p>
            </form>}
          </> : <div className={styles.empty}><p className={styles.emptyLabel}>YOUR CONVERSATIONS</p><h2>Good things start<br />with a hello.</h2><p>{rooms.length ? "Pick a conversation to say hello." : "When you make a match, your conversations will be waiting here."}</p><Link href="/discover">Explore connections <span aria-hidden="true">→</span></Link></div>}
        </div>
      </section>
    </div>
  </main>;
}
