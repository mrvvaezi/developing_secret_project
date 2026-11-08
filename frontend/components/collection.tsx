"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  Download,
  Search,
  ArrowLeft,
  ArrowRight,
  Check,
  Trash2,
  Music2,
} from "lucide-react";
import Artwork from "./artwork";
import { api, fa, fmt, errorText } from "@/lib/api";
import type { Collection as Data, RoomState, Track, Playlist } from "@/lib/types";
export default function Collection({
  kind,
  state,
  compact = false,
  token = "",
  manage = false,
  notify,
  playlistId,
  addToPlaylist,
  onPlaylistChange,
}: {
  playlistId?: number;
  addToPlaylist?: number;
  onPlaylistChange?: () => void;
  kind: "library" | "history";
  state: RoomState | null;
  compact?: boolean;
  token?: string;
  manage?: boolean;
  notify: (s: string) => void;
}) {
  const [data, setData] = useState<Data>({ items: [], total: 0 }),
    [query, setQuery] = useState(""),
    [uploader, setUploader] = useState(""),
    [artist, setArtist] = useState("*"),
    [categories, setCategories] = useState<{uploaders: {name: string; count: number}[]; artists: {name: string; count: number}[]}>({uploaders: [], artists: []}),
    [playlists, setPlaylists] = useState<Playlist[]>([]),
    [targetPlaylist, setTargetPlaylist] = useState(""),
    [artistEdit, setArtistEdit] = useState<{id: string; value: string} | null>(null),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [pending, setPending] = useState<string | null>(null);
  const size = compact ? 4 : 12,
    serverRevision =
      kind === "library" ? state?.library_revision : state?.history_revision;
  useEffect(() => {
    if (compact || kind !== "library" || playlistId) return;
    const controller = new AbortController();
    api<typeof categories>("/api/library/categories", {signal: controller.signal}).then(setCategories).catch((e) => { if (!controller.signal.aborted) notify(errorText(e)); });
    if (!manage && !addToPlaylist)
      api<{items: Playlist[]}>("/api/playlists", {signal: controller.signal}).then((d) => setPlaylists(d.items)).catch((e) => { if (!controller.signal.aborted) notify(errorText(e)); });
  return () => controller.abort();
  }, [compact, kind, playlistId, manage, addToPlaylist, serverRevision, revision, notify]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        api<Data>(
          `/api/${playlistId ? `playlists/${playlistId}/tracks` : manage ? "admin/tracks" : kind}?limit=${size}&offset=${offset}&q=${encodeURIComponent(query)}&uploader=${encodeURIComponent(uploader)}${artist === "*" ? "" : `&artist=${encodeURIComponent(artist)}`}`,
          { signal: controller.signal },
          token,
        )
          .then((d) => {
            setData(d);
            setError("");
            if (offset && offset >= d.total) setOffset(0);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(errorText(e));
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, offset, query, size, serverRevision, revision, manage, token, uploader, artist, playlistId]);
  async function action(t: Track, remove = false) {
    if (pending) return;
    if (
      remove &&
      !confirm(`«${t.title}» از آرشیو، صف و تاریخچه برای همه حذف شود؟`)
    )
      return;
    setPending(t.id);
    try {
      const result = await api<{ file_removed?: boolean }>(
        remove ? `/api/admin/tracks/${t.id}` : `/api/tracks/${t.id}/enqueue`,
        { method: remove ? "DELETE" : "POST" },
        remove ? token : "",
      );
      notify(
        remove
          ? result.file_removed === false
            ? "از آرشیو حذف شد؛ پاک‌کردن فایل روی سرور انجام نشد."
            : "آهنگ حذف شد."
          : "به صف پخش اضافه شد.",
      );
      setRevision((x) => x + 1);
    } catch (e) {
      notify(errorText(e));
    } finally {
      setPending(null);
    }
  }
    async function playlistAction(t: Track) {
    const target = playlistId ?? addToPlaylist ?? Number(targetPlaylist);
    if (!target || pending) return;
    setPending(t.id);
    try {
      await api(`/api/playlists/${target}/tracks/${t.id}`, {method: playlistId ? "DELETE" : "POST"});
      notify(playlistId ? "از پلی‌لیست حذف شد." : "در پلی‌لیست ذخیره شد.");
      setRevision((n) => n + 1);
      onPlaylistChange?.();
    } catch (e) { notify(errorText(e)); }
    finally { setPending(null); }
  }
  async function saveArtist() {
    if (!artistEdit || pending) return;
    setPending(artistEdit.id);
    try {
      await api(`/api/admin/tracks/${artistEdit.id}`, {method: "PATCH", body: JSON.stringify({artist: artistEdit.value})}, token);
      setArtistEdit(null); setRevision((n) => n + 1); notify("خواننده ذخیره شد.");
    } catch (e) { notify(errorText(e)); }
    finally { setPending(null); }
  }
  return (
    <section className="collection">
      <div className="section-heading">
        <div>
          <span className="eyebrow">
            {kind === "library" ? "انتخاب بعدی تو" : "چیزهایی که با هم شنیدیم"}
          </span>
          <h2>
            {playlistId ? "آهنگ‌های پلی‌لیست" : manage
              ? "مدیریت آهنگ‌ها"
              : kind === "library"
                ? "آرشیو موسیقی"
                : "تاریخچهٔ پخش"}{" "}
            <span className="count">{fa(data.total)}</span>
          </h2>
        </div>
        {!compact && kind === "library" && !playlistId && (
          <label className="search">
            <Search size={18} />
            <input
              aria-label="جست‌وجوی آهنگ، خواننده یا آپلودکننده"
              placeholder="آهنگ، خواننده یا نام دوستت…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
          </label>
        )}
      </div>
      {!compact && kind === "library" && !playlistId && <div className="catalog-filters">
        <label>آپلودکننده<select value={uploader} onChange={(e) => { setUploader(e.target.value); setOffset(0); }}>
          <option value="">همهٔ آپلودکننده‌ها</option>
          {categories.uploaders.map((c) => <option key={c.name} value={c.name}>{c.name} ({fa(c.count)})</option>)}
        </select></label>
        <label>خواننده<select value={artist} onChange={(e) => { setArtist(e.target.value); setOffset(0); }}>
          <option value="*">همهٔ خواننده‌ها</option>
          {categories.artists.map((c) => <option key={c.name} value={c.name}>{c.name || "خواننده نامشخص"} ({fa(c.count)})</option>)}
        </select></label>
        {!manage && !addToPlaylist && <label>افزودن آهنگ به پلی‌لیست<select value={targetPlaylist} onChange={(e) => setTargetPlaylist(e.target.value)}>
          <option value="">انتخاب پلی‌لیست…</option>
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select><small>پلی‌لیست جدید را در بخش «پلی‌لیست‌های من» بساز.</small></label>}
      </div>}
      {error ? (
        <div className="empty">
          <p role="alert">{error}</p>
          <button onClick={() => setRevision((x) => x + 1)}>تلاش دوباره</button>
        </div>
      ) : loading && !data.items.length ? (
        <div className="skeleton-grid" aria-label="در حال دریافت آهنگ‌ها">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton" key={i} />
          ))}
        </div>
      ) : !data.items.length ? (
        <div className="empty">
          <Music2 />
          <h3>{playlistId ? "این پلی‌لیست هنوز آهنگی ندارد" : query || uploader || artist !== "*" ? "آهنگی پیدا نشد" : "اینجا منتظر موسیقی شماست"}</h3>
          <p>
            {playlistId ? "با دکمهٔ افزودن آهنگ از آرشیو، لیستت را کامل کن." : query || uploader || artist !== "*"
              ? "جست‌وجو یا فیلترها را تغییر بده."
              : "اولین آهنگ را از بخش افزودن موسیقی به اتاق بیاور."}
          </p>
        </div>
      ) : (
        <div
          className={kind === "library" ? "track-grid" : "history-list"}
          aria-busy={loading}
        >
          {data.items.map((t) => {
            const active =
              state?.current?.id === t.id ||
              state?.queue.some((q) => q.id === t.id);
            return (
              <article className="track-card" key={t.event_id ?? t.id}>
                <div className="cover-wrap">
                  <Artwork seed={t.id} />
                  <span className="duration" dir="ltr">
                    {fmt(t.duration)}
                  </span>
                </div>
                <div className="track-detail">
                  <h3 dir="auto" title={t.title}>
                    {t.title}
                  </h3>
                  <p>خواننده: <bdi>{t.artist || "نامشخص"}</bdi></p>
                  <p>آپلودکننده: <bdi>{t.uploader}</bdi></p>
                  {manage && (artistEdit?.id === t.id ? <form className="artist-editor" onSubmit={(e) => { e.preventDefault(); void saveArtist(); }}>
                    <input aria-label={`خوانندهٔ ${t.title}`} maxLength={120} value={artistEdit.value} onChange={(e) => setArtistEdit({id: t.id, value: e.target.value})} />
                    <button disabled={!!pending}>ذخیره</button><button type="button" disabled={!!pending} onClick={() => setArtistEdit(null)}>انصراف</button>
                  </form> : <button className="text-button" onClick={() => setArtistEdit({id: t.id, value: t.artist || ""})}>ویرایش خواننده</button>)}
                  {kind === "history" && (
                    <small>
                      {t.started_at
                        ? new Date(t.started_at * 1000).toLocaleString("fa-IR")
                        : ""}{" "}
                      ·{" "}
                      {
                        {
                          current: "در حال پخش",
                          completed: "پخش کامل",
                          skipped: "رد شده",
                        }[t.outcome ?? ""]
                      }
                      {t.ended_at && (
                        <>
                          {" "}
                          · پایان:{" "}
                          {new Date(t.ended_at * 1000).toLocaleTimeString(
                            "fa-IR",
                          )}
                        </>
                      )}
                    </small>
                  )}
                </div>
                <div className="track-actions">
                  {!!(playlistId || addToPlaylist || targetPlaylist) && <button className="small-button" disabled={!!pending} onClick={() => void playlistAction(t)}>{playlistId ? "حذف از پلی‌لیست" : "ذخیره در پلی‌لیست"}</button>}
                  <button
                    className="small-button"
                    disabled={!!pending || active}
                    onClick={() => action(t)}
                    aria-label={`افزودن ${t.title} به صف`}
                  >
                    {active ? <Check size={15} /> : <Plus size={15} />}{" "}
                    {active ? "در صف / پخش" : "افزودن به صف"}
                  </button>
                  <a
                    className="icon-button"
                    href={t.url}
                    download={t.title}
                    aria-label={`دانلود ${t.title}`}
                  >
                    <Download size={17} />
                  </a>
                  {manage && (
                    <button
                      className="icon-button danger"
                      disabled={!!pending}
                      onClick={() => action(t, true)}
                      aria-label={`حذف ${t.title}`}
                    >
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!compact && data.total > size && (
        <div className="pagination">
          <button
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - size))}
          >
            <ArrowRight size={16} />
            قبلی
          </button>
          <span>
            {fa(Math.floor(offset / size) + 1)} از{" "}
            {fa(Math.ceil(data.total / size))}
          </span>
          <button
            disabled={offset + size >= data.total || loading}
            onClick={() => setOffset(offset + size)}
          >
            بعدی
            <ArrowLeft size={16} />
          </button>
        </div>
      )}
    </section>
  );
}
