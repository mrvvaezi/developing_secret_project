"use client";
import { useEffect, useState, type FormEvent } from "react";
import {
  ShieldCheck,
  Play,
  Pause,
  SkipForward,
  Shuffle,
  RefreshCw,
  Trash2,
  LogOut,
  Users,
  Radio,
  MessageSquare,
  Heart,
  Disc3,
  Type,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { api, post, errorText, fa, fmt } from "@/lib/api";
import { DEFAULT_SITE_COPY } from "@/lib/site-copy";
import type { RoomState, SiteCopy, User, Message, OnlineUser, Report } from "@/lib/types";
import Collection from "./collection";
import Queue, { type Control } from "./queue";
export default function Admin({
  user,
  state,
  token,
  setToken,
  control,
  pending,
  notify,
  elapsed,
}: {
  user: User;
  state: RoomState | null;
  token: string;
  setToken: (s: string) => void;
  control: Control;
  pending: boolean;
  notify: (s: string) => void;
  elapsed: number;
}) {
  const [tab, setTab] = useState("tracks"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [users, setUsers] = useState<User[]>([]),
    [online, setOnline] = useState<OnlineUser[]>([]),
    [messages, setMessages] = useState<Message[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [loadError, setLoadError] = useState(""),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [seek, setSeek] = useState<number | null>(null),
    [heroTitle, setHeroTitle] = useState(DEFAULT_SITE_COPY.hero_title),
    [heroCover, setHeroCover] = useState(""),
    [heroColor, setHeroColor] = useState("#f0f4ed"),
    [heroAccent, setHeroAccent] = useState("#c4f56c"),
    [copyDirty, setCopyDirty] = useState(false),
    [copySaving, setCopySaving] = useState(false),
    [editingUser, setEditingUser] = useState<number | null>(null),
    [editName, setEditName] = useState(""),
    [editPassword, setEditPassword] = useState("");
  useEffect(() => {
    if (!copyDirty) {
      setHeroTitle(state?.site_copy.hero_title ?? DEFAULT_SITE_COPY.hero_title);
      setHeroCover(state?.site_copy.hero_cover ?? "");
      setHeroColor(state?.site_copy.hero_text_color ?? "#f0f4ed");
      setHeroAccent(state?.site_copy.hero_accent_color ?? "#c4f56c");
    }
  }, [state?.site_copy, copyDirty]);
  useEffect(() => {
    if (!token) return;
    let stopped = false,
      inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      try {
        if (tab === "users") {
          const d = await api<{ items: User[] }>("/api/admin/users", {}, token);
          if (!stopped) setUsers(d.items);
        }
        if (tab === "online") {
          const d = await api<{ items: OnlineUser[] }>(
            "/api/admin/online",
            {},
            token,
          );
          if (!stopped) setOnline(d.items);
        }
        if (tab === "chat") {
          const d = await api<{ items: Message[] }>(
            "/api/admin/chat",
            {},
            token,
          );
          if (!stopped) setMessages(d.items);
        }
        if (tab === "reactions") {
          const d = await api<{ items: Report[] }>(
            "/api/admin/reactions",
            {},
            token,
          );
          if (!stopped) setReports(d.items);
        }
        if (!stopped) setLoadError("");
      } catch (e) {
        if (!stopped) setLoadError(errorText(e));
      } finally {
        inFlight = false;
        if (!stopped) setLoading(false);
      }
    }
    void load();
    const timer =
      tab === "online"
        ? setInterval(() => {
            if (!document.hidden) void load();
          }, 5000)
        : undefined;
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [tab, token, refresh]);
  async function unlock(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const d = await api<{ token: string }>(
        "/api/admin/login",
        post({ password }),
      );
      setToken(d.token);
      setPassword("");
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    try {
      await api(
        "/api/admin/users",
        post({ name: data.get("name"), password: data.get("password") }),
        token,
      );
      form.reset();
      notify("کاربر ساخته شد.");
      setRefresh((x) => x + 1);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveUser(e: FormEvent<HTMLFormElement>, id: number) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api(
        `/api/admin/users/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: editName, password: editPassword }),
        },
        token,
      );
      setEditingUser(null);
      setEditPassword("");
      setRefresh((x) => x + 1);
      notify("اطلاعات کاربر تغییر کرد.");
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function removeChat(id?: number) {
    if (
      busy ||
      !confirm(
        id
          ? "این پیام برای همه حذف شود؟"
          : "پیام‌های نمایش‌داده‌شده برای همه حذف شوند؟ این کار برگشت‌پذیر نیست.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(
        id ? `/api/admin/chat/${id}` : "/api/admin/chat/clear",
        id
          ? { method: "DELETE" }
          : post({ through_id: Math.max(...messages.map((m) => m.id)) }),
        token,
      );
      setRefresh((x) => x + 1);
      notify("پیام‌ها حذف شدند.");
    } catch (e) {
      notify(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveHeroTitle(e: FormEvent) {
    e.preventDefault();
    if (copySaving) return;
    setCopySaving(true);
    try {
      const data = await api<{ site_copy: SiteCopy }>(
        "/api/admin/site-copy",
        { method: "PUT", body: JSON.stringify({ hero_title: heroTitle, hero_cover: heroCover, hero_text_color: heroColor, hero_accent_color: heroAccent }) },
        token,
      );
      setHeroTitle(data.site_copy.hero_title);
      setCopyDirty(false);
      notify("ظاهر کارت برای همه تغییر کرد.");
    } catch (e) {
      notify(errorText(e));
    } finally {
      setCopySaving(false);
    }
  }
  if (!user.is_admin)
    return (
      <div className="empty">
        <ShieldCheck />
        <h2>این بخش مخصوص مدیر اتاق است.</h2>
      </div>
    );
  if (!token)
    return (
      <section className="admin-unlock panel">
        <span className="upload-symbol">
          <ShieldCheck size={32} />
        </span>
        <h2>پشت میز دی‌جی</h2>
        <p className="muted">
          برای کنترل پخش، مدیریت کاربران و آهنگ‌ها، رمز مدیریت را وارد کن.
        </p>
        <form onSubmit={unlock}>
          <label htmlFor="admin-password">رمز مدیریت</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button className="primary" disabled={busy}>
            ورود به مدیریت
          </button>
        </form>
      </section>
    );
  const tabs = [
    ["site-copy", "ظاهر کارت", Type],
    ["tracks", "آهنگ‌ها", Disc3],
    ["users", "کاربران", Users],
    ["online", "آنلاین‌ها", Radio],
    ["chat", "پیام‌ها", MessageSquare],
    ["reactions", "واکنش‌ها", Heart],
  ] as const;
  const grouped = new Map<number, Report[]>();
  reports.forEach((r) =>
    grouped.set(r.play_id, [...(grouped.get(r.play_id) ?? []), r]),
  );
  return (
    <div className="admin-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">کنترل حال‌وهوای اتاق</span>
          <h2>میز دی‌جی</h2>
        </div>
        <button
          className="text-button"
          onClick={() => {
            setToken("");
            setUsers([]);
            setReports([]);
            setOnline([]);
            setMessages([]);
          }}
        >
          <LogOut size={16} />
          خروج از مدیریت
        </button>
      </div>
      <section className="dj-panel">
        <div>
          <span className="live-badge">
            <i />
            مدیریت فعال
          </span>
          <h3>{state?.current?.title ?? "منتظر اولین آهنگ"}</h3>
          <p className="muted">
            نظر جمع: 🔥 {fa(state?.reactions.fire ?? 0)} · ♥{" "}
            {fa(state?.reactions.love ?? 0)} · ↠{" "}
            {fa(state?.reactions.skip ?? 0)}
          </p>
        </div>
        <div className="dj-controls">
          <button
            className="primary"
            disabled={pending}
            onClick={() => void control(state?.playing ? "pause" : "play")}
          >
            {state?.playing ? <Pause size={18} /> : <Play size={18} />}{" "}
            {state?.playing ? "مکث برای همه" : "پخش برای همه"}
          </button>
          <button disabled={pending} onClick={() => void control("next")}>
            <SkipForward size={18} />
            بعدی
          </button>
          <button
            disabled={pending}
            aria-pressed={!!state?.shuffle}
            className={state?.shuffle ? "selected" : ""}
            onClick={() =>
              void control("shuffle", { enabled: !state?.shuffle })
            }
          >
            <Shuffle size={18} />
            تصادفی
          </button>
        </div>
        <label className="seek-label">
          موقعیت پخش برای همه{" "}
          <span dir="ltr">
            {fmt(seek ?? elapsed)} / {fmt(state?.current?.duration)}
          </span>
          <input
            type="range"
            dir="ltr"
            min={0}
            max={state?.current?.duration || 1}
            step="0.1"
            value={seek ?? elapsed}
            disabled={!state?.current || pending}
            onChange={(e) => setSeek(Number(e.target.value))}
            onPointerUp={(e) => {
              void control("seek", { position: Number(e.currentTarget.value) });
              setSeek(null);
            }}
            onKeyUp={(e) => {
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                  "ArrowUp",
                  "ArrowDown",
                ].includes(e.key)
              ) {
                void control("seek", {
                  position: Number(e.currentTarget.value),
                });
                setSeek(null);
              }
            }}
          />
        </label>
      </section>
      <Queue state={state} token={token} control={control} pending={pending} />
      <nav className="admin-tabs" aria-label="بخش‌های مدیریت">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      {tab !== "tracks" && (
        <div className="section-heading">
          <span className="muted">
            {tab === "online"
              ? "به‌روزرسانی خودکار هر ۵ ثانیه؛ تشخیص دستگاه تقریبی است."
              : tab === "reactions"
                ? "آخرین ۱۰۰۰ واکنش؛ نام افراد فقط برای مدیر نمایش داده می‌شود."
                : ""}
          </span>
          <button disabled={loading} onClick={() => setRefresh((x) => x + 1)}>
            <RefreshCw size={15} />
            به‌روزرسانی
          </button>
        </div>
      )}
      {loadError && (
        <p role="alert" className="error-text">
          {loadError}
        </p>
      )}
      {tab === "site-copy" && (
        <form className="panel copy-editor" onSubmit={saveHeroTitle}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">نمایش برای همهٔ اعضای اتاق</span>
              <h3>کاور و متن کارت اصلی</h3>
            </div>
            <Type size={22} aria-hidden="true" />
          </div>
          <label htmlFor="hero-title">متن تیتر</label>
          <textarea
            id="hero-title"
            rows={3}
            maxLength={100}
            required
            value={heroTitle}
            onChange={(e) => {
              setHeroTitle(e.target.value);
              setCopyDirty(true);
            }}
            aria-describedby="hero-title-help"
          />
          <p id="hero-title-help" className="muted small">
            با Enter تیتر را در خط بعدی ادامه بده. حداکثر ۱۰۰ کاراکتر و سه خط.
          </p>
          <label htmlFor="hero-cover">عکس پس‌زمینهٔ تمام کارت (PNG، JPEG یا WebP؛ حداکثر ۵۰۰ کیلوبایت)</label>
          <input id="hero-cover" type="file" accept="image/png,image/jpeg,image/webp" disabled={copySaving}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 500 * 1024) {
                notify("عکس PNG، JPEG یا WebP تا ۵۰۰ کیلوبایت انتخاب کن."); return;
              }
              try {
                const value = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result));
                  reader.onerror = () => reject(new Error("خواندن عکس ناموفق بود."));
                  reader.readAsDataURL(file);
                });
                setHeroCover(value); setCopyDirty(true);
              } catch { notify("خواندن عکس ناموفق بود."); }
            }} />
          <button type="button" disabled={copySaving || !heroCover} onClick={() => { setHeroCover(""); setCopyDirty(true); }}>کاور پیش‌فرض</button>
          <label htmlFor="hero-color">رنگ متن تیتر</label>
          <input id="hero-color" type="color" value={heroColor} onChange={(e) => { setHeroColor(e.target.value); setCopyDirty(true); }} />
          <label htmlFor="hero-accent">رنگ کلمهٔ برجسته</label>
          <input id="hero-accent" type="color" value={heroAccent} onChange={(e) => { setHeroAccent(e.target.value); setCopyDirty(true); }} />
          <div className={`copy-preview${heroCover ? " hero-with-cover" : ""}`} aria-label="پیش‌نمایش کارت">
            {heroCover && <img className="hero-background" src={heroCover} alt="" />}
            <small>پیش‌نمایش روی کارت</small>
            <strong dir="auto" style={{ color: heroColor }}>{heroTitle.slice(0, Math.max(heroTitle.lastIndexOf(" "), heroTitle.lastIndexOf("\n")) + 1)}<span style={{ color: heroAccent }}>{heroTitle.slice(Math.max(heroTitle.lastIndexOf(" "), heroTitle.lastIndexOf("\n")) + 1)}</span></strong>
          </div>
          <div className="copy-actions">
            <button
              className="primary"
              type="submit"
              disabled={!copyDirty || copySaving || !heroTitle.trim()}
            >
              {copySaving ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}
            </button>
            <button
              type="button"
              disabled={copySaving}
              onClick={() => {
                setHeroTitle(DEFAULT_SITE_COPY.hero_title);
                setCopyDirty(true);
              }}
            >
              متن پیش‌فرض
            </button>
          </div>
        </form>
      )}
      {tab === "tracks" && (
        <Collection
          kind="library"
          state={state}
          token={token}
          manage
          notify={notify}
        />
      )}
      {tab === "users" && (
        <div className="admin-columns">
          <form className="panel user-form" onSubmit={create}>
            <h3>ساخت حساب کاربری</h3>
            <label htmlFor="new-name">نام کاربری</label>
            <input id="new-name" name="name" required maxLength={40} />
            <label htmlFor="new-password">رمز عبور</label>
            <input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
            />
            <button className="primary" disabled={busy}>
              ساخت کاربر
            </button>
            <p className="small muted">
              برای فعال‌سازی کاربر قدیمی، نام او را با رمز جدید وارد کن.
            </p>
          </form>
          <div className="panel">
            {users.map((u) => (
              <div className="user-item" key={u.id}>
                <div className="user-row">
                  <span className="avatar">{u.name.slice(0, 1)}</span>
                  <bdi>{u.name}</bdi>
                  <span className="chip">
                    {u.is_admin
                      ? "مدیر"
                      : u.active
                        ? "فعال"
                        : "نیازمند فعال‌سازی"}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    title={`ویرایش ${u.name}`}
                    aria-label={`ویرایش ${u.name}`}
                    onClick={() => {
                      setEditingUser(u.id);
                      setEditName(u.name);
                      setEditPassword("");
                    }}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
                {editingUser === u.id && (
                  <form
                    className="user-edit-form"
                    onSubmit={(e) => void saveUser(e, u.id)}
                  >
                    <label htmlFor={`edit-name-${u.id}`}>نام کاربری</label>
                    <input
                      id={`edit-name-${u.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={40}
                      required
                    />
                    <label htmlFor={`edit-password-${u.id}`}>
                      رمز جدید <span className="muted">(اختیاری)</span>
                    </label>
                    <input
                      id={`edit-password-${u.id}`}
                      type="password"
                      value={editPassword}
                      onChange={(e) => setEditPassword(e.target.value)}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      placeholder="برای حفظ رمز فعلی خالی بگذار"
                    />
                    <div className="user-edit-actions">
                      <button className="primary" disabled={busy}>
                        <Save size={15} /> ذخیره
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setEditingUser(null)}
                      >
                        <X size={15} /> انصراف
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ))}
            {!users.length && !loading && (
              <p className="muted">کاربری یافت نشد.</p>
            )}
          </div>
        </div>
      )}
      {tab === "online" && (
        <div className="panel">
          {online.map((u) => (
            <article className="online-user" key={u.id}>
              <h3>
                <span className="online-dot" />
                {u.name}
              </h3>
              {u.connections.map((c, i) => (
                <p className="muted" key={i}>
                  {c.device} · {c.os} · {c.browser}
                </p>
              ))}
            </article>
          ))}
          {!online.length && !loading && (
            <p className="muted">کسی آنلاین نیست.</p>
          )}
        </div>
      )}
      {tab === "chat" && (
        <div className="panel">
          <button
            className="danger"
            disabled={!messages.length || busy}
            onClick={() => removeChat()}
          >
            <Trash2 size={16} />
            پاک‌کردن پیام‌های نمایش‌داده‌شده
          </button>
          {messages.map((m) => (
            <div className="moderation-row" key={m.id}>
              <div>
                <bdi>{m.name}</bdi>
                <p dir="auto">{m.text}</p>
              </div>
              <button
                className="icon-button danger"
                disabled={busy}
                aria-label={`حذف پیام ${m.name}`}
                onClick={() => removeChat(m.id)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          {!messages.length && !loading && (
            <p className="muted">پیامی وجود ندارد.</p>
          )}
        </div>
      )}
      {tab === "reactions" && (
        <div className="report-list">
          {[...grouped].map(([id, items]) => (
            <article key={id} className="panel">
              <h3>{items[0].title}</h3>
              <small className="muted">
                نوبت پخش {fa(id)} · {fa(items.length)} واکنش
              </small>
              <div className="report-columns">
                {(["fire", "love", "skip"] as const).map((k) => (
                  <section key={k}>
                    <h4>
                      {
                        {
                          fire: "🔥 عالیه",
                          love: "♥ دوستش دارم",
                          skip: "↠ بعدی",
                        }[k]
                      }
                    </h4>
                    <div>
                      {items
                        .filter((r) => r.reaction === k)
                        .map((r, i) => (
                          <bdi className="chip" key={i}>
                            {r.name}
                          </bdi>
                        ))}
                      {!items.some((r) => r.reaction === k) && (
                        <small className="muted">بدون واکنش</small>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          ))}
          {!reports.length && !loading && (
            <div className="empty">هنوز واکنشی ثبت نشده.</div>
          )}
        </div>
      )}
    </div>
  );
}
