"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { api, errorText } from "./api";
import { mergeMessages, positionAt } from "./room-state";
import type { User, RoomState, RoomEvent, Message } from "./types";
export function useRoom() {
  const [user, setUser] = useState<User | null>(null),
    [state, setState] = useState<RoomState | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const current = useRef<RoomState | null>(null),
    received = useRef(0);
  const receive = useCallback((s: RoomState) => {
    current.current = s;
    received.current = performance.now();
    setState(s);
  }, []);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let reconnects = 0;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      socket.onopen = () => {
        reconnects = 0;
        setConnected(true);
        setError("");
      };
      socket.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data) as RoomEvent;
          if (event.type === "state") receive(event);
          else setMessages((old) => mergeMessages(old, event));
        } catch {
          setError("دریافت وضعیت اتاق انجام نشد.");
        }
      };
      socket.onerror = () => setConnected(false);
      socket.onclose = async (e) => {
        if (disposed) return;
        setConnected(false);
        if (e.code === 4401) {
          location.replace("/login");
          return;
        }
        try {
          await api("/api/auth/me");
        } catch {}
        if (!disposed)
          timer = setTimeout(
            connect,
            Math.min(10000, 1000 * 2 ** reconnects++),
          );
      };
    };
    api<{ user: User }>("/api/auth/me")
      .then((data) => {
        if (disposed) return;
        setUser(data.user);
        connect();
      })
      .catch((e) => {
        if (!disposed) setError(errorText(e));
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [receive, retry]);
  return {
    user,
    state,
    messages,
    connected,
    error,
    retry: () => setRetry((x) => x + 1),
    position: () =>
      positionAt(current.current, received.current, performance.now()),
  };
}
export function useAudio(
  state: RoomState | null,
  position: () => number,
  connected: boolean,
) {
  const audio = useRef<HTMLAudioElement | null>(null),
    stateRef = useRef(state),
    positionRef = useRef(position),
    enabledRef = useRef(false),
    connectedRef = useRef(connected);
  const [enabled, setEnabled] = useState(false),
    [volume, setVolume] = useState(0.8),
    [elapsed, setElapsed] = useState(0),
    [audioError, setAudioError] = useState("");
  stateRef.current = state;
  positionRef.current = position;
  connectedRef.current = connected;
  const sync = useCallback(() => {
    const el = audio.current,
      s = stateRef.current;
    if (!el) return;
    if (!s?.current) {
      el.pause();
      el.removeAttribute("src");
      return;
    }
    if (el.getAttribute("src") !== s.current.url) {
      el.src = s.current.url;
      el.load();
    }
    if (!connectedRef.current || !enabledRef.current || !s.playing) {
      el.pause();
      return;
    }
    const target = Math.min(
      positionRef.current(),
      Math.max(0, s.current.duration - 0.03),
    );
    if (el.readyState >= 1 && Math.abs(el.currentTime - target) > 1.3)
      el.currentTime = target;
    if (el.paused)
      void el
        .play()
        .then(() => setAudioError(""))
        .catch(() => {
          enabledRef.current = false;
          setEnabled(false);
          setAudioError("برای فعال شدن صدا، دوباره دکمهٔ شنیدن را بزن.");
        });
  }, []);
  useEffect(() => {
    const el = new Audio();
    el.preload = "auto";
    el.volume = 0.8;
    audio.current = el;
    el.addEventListener("loadedmetadata", sync);
    const onError = () => setAudioError("پخش فایل انجام نشد؛ دوباره تلاش کن.");
    el.addEventListener("error", onError);
    const interval = setInterval(() => {
      setElapsed(positionRef.current());
      sync();
    }, 300);
    return () => {
      clearInterval(interval);
      el.pause();
      el.removeAttribute("src");
      el.removeEventListener("loadedmetadata", sync);
      el.removeEventListener("error", onError);
      audio.current = null;
    };
  }, [sync]);
  useEffect(() => {
    sync();
  }, [state, connected, sync]);
  function toggle() {
    enabledRef.current = !enabledRef.current;
    setEnabled(enabledRef.current);
    setAudioError("");
    sync();
  }
  function changeVolume(value: number) {
    setVolume(value);
    if (audio.current) audio.current.volume = value;
  }
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = state?.current
      ? new MediaMetadata({
          title: state.current.title,
          artist: state.current.uploader,
          album: "موزیک‌روم",
        })
      : null;
    navigator.mediaSession.setActionHandler("play", () => {
      enabledRef.current = true;
      setEnabled(true);
      sync();
    });
    navigator.mediaSession.setActionHandler("pause", () => {
      enabledRef.current = false;
      setEnabled(false);
      sync();
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
    };
  }, [state?.current?.id, sync]);
  return { enabled, volume, elapsed, audioError, toggle, changeVolume };
}
