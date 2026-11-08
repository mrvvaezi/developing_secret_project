"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, MessageCircle, ArrowDown } from "lucide-react";
import { api, post, fa, errorText } from "@/lib/api";
import type { Message } from "@/lib/types";
export default function Chat({
  messages,
  connected,
  name,
}: {
  messages: Message[];
  connected: boolean;
  name: string;
}) {
  const [text, setText] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [unread, setUnread] = useState(false);
  const list = useRef<HTMLDivElement>(null),
    atBottom = useRef(true),
    sending = useRef(false);
  function bottom() {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
    atBottom.current = true;
    setUnread(false);
  }
  useEffect(() => {
    if (atBottom.current) bottom();
    else setUnread(true);
  }, [messages]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (sending.current || !connected || !text.trim()) return;
    sending.current = true;
    setPending(true);
    setError("");
    try {
      await api("/api/chat", post({ text: text.trim() }));
      setText("");
      bottom();
    } catch (e) {
      setError(errorText(e));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <section className="chat-panel">
      <div className="section-heading">
        <h2>
          <MessageCircle size={19} /> گپِ اتاق
        </h2>
        <span className={`live-badge ${connected ? "" : "offline"}`}>
          <i />
          {connected ? "زنده" : "در حال اتصال"}
        </span>
      </div>
      <div
        className="chat-messages"
        ref={list}
        role="log"
        aria-label="پیام‌های اتاق"
        aria-live="polite"
        tabIndex={0}
        onScroll={() => {
          const el = list.current;
          if (el) {
            atBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            if (atBottom.current) setUnread(false);
          }
        }}
      >
        {!messages.length && (
          <div className="empty">
            <MessageCircle />
            <p>اولین پیام این جمع را تو بنویس.</p>
          </div>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={`message ${m.name === name ? "mine" : ""}`}
          >
            <span className="avatar">{m.name.slice(0, 1)}</span>
            <div>
              <header>
                <bdi>{m.name}</bdi>
                <time dateTime={new Date(m.created_at * 1000).toISOString()}>
                  {new Date(m.created_at * 1000).toLocaleTimeString("fa-IR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </header>
              <p dir="auto">{m.text}</p>
            </div>
          </article>
        ))}
      </div>
      {unread && (
        <button className="new-messages" onClick={bottom}>
          پیام جدید <ArrowDown size={14} />
        </button>
      )}
      <form className="chat-compose" onSubmit={send}>
        <label className="sr-only" htmlFor="chat-text">
          پیام شما
        </label>
        <textarea
          id="chat-text"
          dir="auto"
          placeholder="دربارهٔ این آهنگ چی فکر می‌کنی؟"
          maxLength={500}
          value={text}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div>
          <small>{fa(text.length)} / ۵۰۰</small>
          <button
            type="submit"
            className="primary"
            disabled={!connected || pending || !text.trim()}
            aria-label="ارسال پیام"
          >
            <Send size={16} />
          </button>
        </div>
      </form>
      <p role="status" className="error-text">
        {error}
      </p>
    </section>
  );
}
