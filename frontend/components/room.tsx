"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  House,
  Library,
  ListMusic,
  History,
  Upload,
  ShieldCheck,
  MessageCircle,
  Headphones,
  ArrowUpLeft,
  Play,
  Pause,
  SkipForward,
  Volume2,
  LogOut,
  Plus,
  X,
  Radio,
  Download,
} from "lucide-react";
import { useRoom, useAudio } from "@/lib/use-room";
import { api, post, fa, fmt, errorText } from "@/lib/api";
import Artwork from "./artwork";
import { DEFAULT_SITE_COPY } from "@/lib/site-copy";
import Collection from "./collection";
import Playlists from "./playlists";
import NextPlans from "./next-plans";
import Queue from "./queue";
import Chat from "./chat";
import UploadPanel from "./upload";
import Admin from "./admin";
import Reactions from "./reactions";
type View =
  | "home"
  | "playlists"
  | "library"
  | "queue"
  | "history"
  | "upload"
  | "chat"
  | "admin";
const nav = [
  ["home", "اتاق من", House],
  ["library", "آرشیو موسیقی", Library],
  ["playlists", "پلی‌لیست‌های من", ListMusic],
  ["queue", "صف پخش", ListMusic],
  ["history", "تاریخچه", History],
  ["upload", "افزودن آهنگ", Upload],
  ["chat", "گپ اتاق", MessageCircle],
] as const;
export default function Room({ initialView = "home" }: { initialView?: View }) {
  const room = useRoom(),
    player = useAudio(room.state, room.position, room.connected);
  const [view, setView] = useState<View>(initialView),
    [token, setToken] = useState(""),
    [toast, setToast] = useState(""),
    [pending, setPending] = useState(false),
    [leaving, setLeaving] = useState(false),
    [volumeOpen, setVolumeOpen] = useState(false),
    [nextPlansOpen, setNextPlansOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    controlBusy = useRef(false);
  const notify = useCallback((text: string) => {
    setToast(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 5500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    const read = () => {
      const hash = location.hash.slice(1);
      if ([...nav.map(([id]) => id), "admin"].includes(hash))
        setView(hash as View);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  function navigate(next: View) {
    setView(next);
    history.replaceState(null, "", `${location.pathname}#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function control(action: string, extra: Record<string, unknown> = {}) {
    if (controlBusy.current) return;
    controlBusy.current = true;
    setPending(true);
    try {
      await api("/api/admin/control", post({ action, ...extra }), token);
    } catch (e) {
      notify(errorText(e));
    } finally {
      controlBusy.current = false;
      setPending(false);
    }
  }
  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
      location.replace("/login");
    } catch (e) {
      notify(errorText(e));
      setLeaving(false);
    }
  }
  if (!room.user)
    return (
      <main className="loading-screen">
        <AudioLines size={42} />
        <h1>موزیک‌روم</h1>
        <p role="status">{room.error || "در حال ورود به اتاق…"}</p>
        {room.error && <button onClick={room.retry}>تلاش دوباره</button>}
      </main>
    );
  const s = room.state,
    copy = s?.site_copy ?? DEFAULT_SITE_COPY,
    title = nav.find(([id]) => id === view)?.[1] ?? "مدیریت اتاق";
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        رفتن به محتوای اصلی
      </a>
      <aside className="sidebar">
        <a className="brand" href="/#home">
          <AudioLines />
          <span>
            موزیک‌روم<span className="brand-dot">.</span>
          </span>
        </a>
        <span className="nav-caption">فضای مشترک ما</span>
        <nav aria-label="ناوبری اصلی">
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "queue" && !!s?.queue.length && (
                <b>{fa(s.queue.length)}</b>
              )}
            </button>
          ))}
        </nav>
        {room.user.is_admin && (
          <button
            className={`nav-item admin-nav ${view === "admin" ? "active" : ""}`}
            onClick={() => navigate("admin")}
          >
            <ShieldCheck size={20} />
            مدیریت اتاق
          </button>
        )}
        <div className="sidebar-bottom">
          <div className="invite-card">
            <Headphones size={25} />
            <strong>
              سلیقهٔ تو،
              <br />
              حال خوب همه.
            </strong>
            <p>یک آهنگ به جمع اضافه کن.</p>
            <button onClick={() => navigate("upload")}>
              انتخاب آهنگ <Plus size={16} />
            </button>
          </div>
          <span className={`connection ${room.connected ? "" : "offline"}`}>
            <i />
            {room.connected ? "متصل به اتاق" : "در حال اتصال مجدد…"}
          </span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <AudioLines className="mobile-logo" />
            <span>فضای موسیقی شما</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <span className="listeners">
              <span className="online-dot" />
              {fa(s?.listeners ?? 0)} نفر در اتاق
            </span>
            <div className="profile">
              <span className="avatar">{room.user.name.slice(0, 1)}</span>
              <bdi>{room.user.name}</bdi>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              disabled={leaving}
              aria-label="خروج از حساب"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main id="main" className="main-content">
          {!room.connected && (
            <div className="connection-banner" role="status">
              {room.error ||
                "در حال اتصال به اتاق؛ پخش پس از اتصال همگام می‌شود."}
            </div>
          )}
          {view === "home" && (
            <>
              <div className="home-grid">
                <div className="home-main">
                  <section className={`hero${copy.hero_cover ? " hero-with-cover" : ""}`}>
                    {copy.hero_cover && <img className="hero-background" src={copy.hero_cover} alt="" />}
                    <div className="hero-copy">
                      <span className="hero-tag">
                        <Radio size={14} />
                        صدای زندهٔ جمع ما
                      </span>
                      <h2 className="editable-hero-title" style={{ color: copy.hero_text_color }}>
                        {copy.hero_title
                          .split("\n")
                          .map((line, index, lines) => {
                            if (index < lines.length - 1)
                              return (
                                <span key={index}>
                                  {line}
                                  <br />
                                </span>
                              );
                            const at = line.lastIndexOf(" ");
                            return (
                              <span key={index}>
                                {line.slice(0, at + 1)}
                                <em style={{ color: copy.hero_accent_color }}>{line.slice(at + 1)}</em>
                              </span>
                            );
                          })}
                      </h2>
                      <p>
                        آهنگ‌های تو، انتخاب‌های دوستات.
                        <br />
                        همه در یک لحظه، با یک ریتم.
                      </p>
                      <button
                        className="primary"
                        onClick={() => navigate("upload")}
                      >
                        آهنگت رو اضافه کن <ArrowUpLeft size={18} />
                      </button>
                      <span className="hero-bottom">
                        CURATED BY US. PLAYED TOGETHER.
                      </span>
                    </div>
                    {!copy.hero_cover && <div className="hero-art">
                      <Artwork
                        seed="musicroom-green"
                        large
                        playing={!!s?.playing}
                      />
                      <span className="floating-label">
                        <AudioLines size={18} /> موسیقی، کنار هم
                      </span>
                    </div>}
                  </section>
                  <section className="now-card">
                    <div className="now-heading">
                      <span className="live-badge">
                        <i />
                        {s?.current
                          ? s.playing
                            ? "همین حالا در اتاق"
                            : "پخش متوقف است"
                          : "منتظر موسیقی"}
                      </span>
                      <span className="tiny-label">ON AIR</span>
                    </div>
                    <div className="now-track">
                      <Artwork seed={s?.current?.id} />
                      <div>
                        <h2 dir="auto">
                          {s?.current?.title ?? "اولین آهنگ را تو انتخاب کن"}
                        </h2>
                        <p>
                          {s?.current
                            ? `انتخاب ${s.current.uploader}`
                            : "یک MP3 اضافه کن تا اتاق جان بگیرد."}
                        </p>
                      </div>
                      <button
                        className="round-play"
                        disabled={!s?.current || !room.connected}
                        onClick={player.toggle}
                        aria-label={
                          player.enabled ? "قطع صدای من" : "شروع شنیدن"
                        }
                      >
                        {player.enabled ? (
                          <Pause fill="currentColor" />
                        ) : (
                          <Play fill="currentColor" />
                        )}
                      </button>
                      <button className="next-plan-trigger" aria-label="نکست؛ نمایش پلن‌ها" aria-haspopup="dialog" onClick={() => setNextPlansOpen(true)}><SkipForward size={19} fill="currentColor" /></button>
                    </div>
                    <Reactions state={s} notify={notify} />
                  </section>
                  <div className="collection-toplink">
                    <button
                      className="text-button"
                      onClick={() => navigate("library")}
                    >
                      همهٔ آهنگ‌ها <ArrowUpLeft size={16} />
                    </button>
                  </div>
                  <Collection
                    kind="library"
                    state={s}
                    compact
                    notify={notify}
                  />
                </div>
                <aside className="home-aside">
                  <Queue
                    state={s}
                    token={token}
                    control={control}
                    pending={pending}
                    compact
                  />
                  {(s?.queue.length ?? 0) > 5 && (
                    <button
                      className="text-button"
                      onClick={() => navigate("queue")}
                    >
                      نمایش تمام صف <ArrowUpLeft size={15} />
                    </button>
                  )}
                  <Chat
                    messages={room.messages}
                    connected={room.connected}
                    name={room.user.name}
                  />
                </aside>
              </div>
            </>
          )}
          {view === "library" && (
            <Collection kind="library" state={s} notify={notify} />
          )}
          {view === "playlists" && <Playlists state={s} notify={notify} />}
          {view === "history" && (
            <Collection kind="history" state={s} notify={notify} />
          )}
          {view === "queue" && (
            <Queue
              state={s}
              token={token}
              control={control}
              pending={pending}
            />
          )}
          <div hidden={view !== "upload"}>
            <UploadPanel name={room.user.name} />
          </div>
          {view === "chat" && (
            <div className="full-chat">
              <Chat
                messages={room.messages}
                connected={room.connected}
                name={room.user.name}
              />
            </div>
          )}
          {view === "admin" && (
            <Admin
              user={room.user}
              state={s}
              token={token}
              setToken={setToken}
              control={control}
              pending={pending}
              notify={notify}
              elapsed={player.elapsed}
            />
          )}
          <footer className="page-footer">
            <span>هر آهنگ، یک خاطرهٔ مشترک.</span>
            <AudioLines size={18} />
            <span dir="ltr">MUSIC ROOM / VOL. 02</span>
          </footer>
        </main>
      </div>
      {nextPlansOpen && <NextPlans onClose={() => setNextPlansOpen(false)} />}
      <footer className="player-dock" aria-label="پخش‌کنندهٔ موسیقی">
        <div className="dock-track">
          <Artwork seed={s?.current?.id} />
          <div>
            <strong dir="auto">
              {s?.current?.title ?? "هنوز آهنگی پخش نمی‌شود"}
            </strong>
            <small>
              {player.audioError ||
                (player.enabled
                  ? room.connected
                    ? s?.playing
                      ? "در حال شنیدن با جمع"
                      : "پخش توسط مدیر متوقف شده"
                    : "در انتظار اتصال"
                  : "برای شنیدن، دکمهٔ پخش را بزن")}
            </small>
          </div>
        </div>
        <div className="dock-center">
          <div className="dock-controls">
            <Headphones size={18} />
            <button
              className="round-play"
              disabled={!s?.current || !room.connected}
              onClick={player.toggle}
              aria-label={player.enabled ? "قطع صدای من" : "شروع شنیدن"}
            >
              {player.enabled ? (
                <Pause size={19} fill="currentColor" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
            </button>
            <button className="next-plan-trigger" aria-label="نکست؛ نمایش پلن‌ها" aria-haspopup="dialog" onClick={() => setNextPlansOpen(true)}><SkipForward size={19} fill="currentColor" /></button>
            <span className="live-label">LIVE</span>
          </div>
          <div className="dock-progress" dir="ltr">
            <span>{fmt(player.elapsed)}</span>
            <progress
              value={player.elapsed}
              max={s?.current?.duration || 1}
              aria-label="زمان پخش"
            />
            <span>{fmt(s?.current?.duration)}</span>
          </div>
        </div>
        <div className={`dock-volume ${volumeOpen ? "volume-open" : ""}`}>
          <button
            className="icon-button volume-toggle"
            aria-label="تنظیم بلندی صدا"
            aria-expanded={volumeOpen}
            onClick={() => setVolumeOpen(!volumeOpen)}
          >
            <Volume2 size={19} />
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={player.volume}
            onChange={(e) => player.changeVolume(Number(e.target.value))}
            aria-label="بلندی صدا"
            dir="ltr"
          />
          {s?.current && (
            <a
              className="icon-button"
              href={s.current.url}
              download={s.current.title}
              aria-label="دانلود آهنگ جاری"
            >
              <Download size={17} />
            </a>
          )}
          <button
            className="icon-button"
            onClick={() => navigate("queue")}
            aria-label="نمایش صف"
          >
            <ListMusic size={20} />
          </button>
        </div>
      </footer>
      <nav className="mobile-nav" aria-label="ناوبری موبایل">
        {(
          [
            ["home", "خانه", House],
            ["library", "آرشیو", Library],
            ["playlists", "لیست‌ها", ListMusic],
            ["upload", "افزودن", Plus],
            ["chat", "گپ", MessageCircle],
            [
              room.user.is_admin ? "admin" : "queue",
              room.user.is_admin ? "مدیریت" : "صف",
              room.user.is_admin ? ShieldCheck : ListMusic,
            ],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => navigate(id)}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
        <button
          onClick={() => navigate("history")}
          className={view === "history" ? "active" : ""}
        >
          <History size={21} />
          <span>تاریخچه</span>
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="بستن پیام"
            onClick={() => setToast("")}
          >
            <X size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
