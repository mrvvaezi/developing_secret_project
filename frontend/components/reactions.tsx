"use client";
import { useEffect, useRef, useState } from "react";
import { api, post, fa, errorText } from "@/lib/api";
import type { Reaction, RoomState } from "@/lib/types";
const kinds: [Reaction, string, string][] = [
  ["fire", "🔥", "عالیه"],
  ["love", "♥", "دوستش دارم"],
  ["skip", "↠", "بعدی"],
];
export default function Reactions({
  state,
  notify,
}: {
  state: RoomState | null;
  notify: (text: string) => void;
}) {
  const playId = state?.play_id;
  const current = useRef(playId);
  current.current = playId;
  const [mine, setMine] = useState<Reaction | null>(null),
    [loaded, setLoaded] = useState<number | null>(null),
    [pending, setPending] = useState(false),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setMine(null);
    setLoaded(null);
    setError("");
    if (playId)
      api<{ mine: Reaction | null }>(`/api/reactions/${playId}`)
        .then((d) => {
          if (!cancelled) {
            setMine(d.mine);
            setLoaded(playId);
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errorText(e));
        });
    return () => {
      cancelled = true;
    };
  }, [playId, retry]);
  async function react(kind: Reaction) {
    if (!playId || pending) return;
    const id = playId;
    setPending(true);
    try {
      const d = await api<{ mine: Reaction | null }>(
        "/api/reactions",
        post({ play_id: id, reaction: mine === kind ? null : kind }),
      );
      if (current.current === id) setMine(d.mine);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="reactions">
      <div>
        <strong>حست به این آهنگ؟</strong>
        <small>یک واکنش برای جمع، یک حس مشترک.</small>
      </div>
      <div className="reaction-buttons">
        {kinds.map(([kind, emoji, label]) => (
          <button
            key={kind}
            className={mine === kind ? "selected" : ""}
            aria-label={label}
            aria-pressed={mine === kind}
            disabled={!playId || loaded !== playId || pending}
            onClick={() => react(kind)}
          >
            <span>{emoji}</span>
            <span className="reaction-label">{label}</span>
            <b>{fa(state?.reactions[kind] ?? 0)}</b>
          </button>
        ))}
      </div>
      {error && (
        <button onClick={() => setRetry((x) => x + 1)} className="text-button">
          دریافت واکنش ناموفق بود؛ تلاش دوباره
        </button>
      )}
    </div>
  );
}
