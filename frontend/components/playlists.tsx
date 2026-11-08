"use client";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, fa, post } from "@/lib/api";
import type { Playlist, RoomState } from "@/lib/types";
import Collection from "./collection";

export default function Playlists({ state, notify }: {state: RoomState | null; notify: (s: string) => void}) {
  const [items, setItems] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [rename, setRename] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const changed = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    api<{items: Playlist[]}>("/api/playlists", {signal: controller.signal})
      .then((d) => { setItems(d.items); setError(""); })
      .catch((e) => { if (!controller.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, state?.library_revision]);
  const current = items.find((p) => p.id === selected);
  async function mutate(action: "create" | "rename" | "delete" | "enqueue") {
    if (busy || (action !== "create" && !current)) return;
    if (action === "delete" && !confirm(`پلی‌لیست «${current?.name}» حذف شود؟ آهنگ‌ها در آرشیو باقی می‌مانند.`)) return;
    setBusy(true);
    try {
      if (action === "create") {
        const created = await api<Playlist>("/api/playlists", post({name}));
        setSelected(created.id); setRename(created.name); setName(""); setAdding(true);
        notify("پلی‌لیست ساخته شد؛ آهنگ‌ها را از آرشیو انتخاب کن.");
      } else if (action === "rename") {
        await api(`/api/playlists/${selected}`, {method: "PATCH", body: JSON.stringify({name: rename})});
        notify("نام پلی‌لیست تغییر کرد.");
      } else if (action === "delete") {
        await api(`/api/playlists/${selected}`, {method: "DELETE"});
        setSelected(null); notify("پلی‌لیست حذف شد.");
      } else {
        const result = await api<{added: number; skipped: number}>(`/api/playlists/${selected}/enqueue`, {method: "POST"});
        notify(`${fa(result.added)} آهنگ به صف اضافه شد.${result.skipped ? ` ${fa(result.skipped)} آهنگ تکراری یا در دسترس نبود.` : ""}`);
      }
      changed();
    } catch (e) { notify(errorText(e)); }
    finally { setBusy(false); }
  }
  return <section className="playlists-page">
    <div className="section-heading"><div><span className="eyebrow">مجموعه‌های شخصی تو</span><h2>پلی‌لیست‌های من</h2></div></div>
    <p className="muted">پلی‌لیست‌ها در حساب تو ذخیره می‌شوند. با افزودن به صف، آهنگ‌هایشان در اتاق برای همه پخش می‌شوند.</p>
    <form className="playlist-create" onSubmit={(e) => { e.preventDefault(); void mutate("create"); }}>
      <label htmlFor="playlist-name">نام پلی‌لیست جدید</label>
      <input id="playlist-name" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً آهنگ‌های شب" />
      <button className="primary" disabled={busy || !name.trim()}>ساخت پلی‌لیست</button>
    </form>
    {error && <div role="alert"><p>{error}</p><button onClick={changed}>تلاش دوباره</button></div>}
    {loading && !items.length && <p role="status">در حال دریافت پلی‌لیست‌ها…</p>}
    {!loading && !error && !items.length && <p className="empty">هنوز پلی‌لیستی نساخته‌ای.</p>}
    <div className="playlist-list" aria-label="پلی‌لیست‌های شخصی">
      {items.map((p) => <button key={p.id} disabled={busy} className={p.id === selected ? "selected" : ""} aria-pressed={p.id === selected} onClick={() => {setSelected(p.id); setRename(p.name); setAdding(false);}}><bdi>{p.name}</bdi><span>{fa(p.count)} آهنگ</span></button>)}
    </div>
    {current && <div className="playlist-detail">
      <div className="panel playlist-tools">
        <form className="playlist-create" onSubmit={(e) => {e.preventDefault(); void mutate("rename");}}>
          <label htmlFor="playlist-rename">نام پلی‌لیست</label><input id="playlist-rename" value={rename} maxLength={100} required onChange={(e) => setRename(e.target.value)} />
          <button disabled={busy || !rename.trim() || rename.trim() === current.name}>ذخیرهٔ نام</button>
        </form>
        <div className="copy-actions">
          <button className="primary" disabled={busy || !current.count} onClick={() => void mutate("enqueue")}>افزودن همه به صف اتاق</button>
          <button disabled={busy} aria-pressed={adding} onClick={() => setAdding(!adding)}>{adding ? "نمایش آهنگ‌های پلی‌لیست" : "افزودن آهنگ از آرشیو"}</button>
          <button className="danger" disabled={busy} onClick={() => void mutate("delete")}>حذف پلی‌لیست</button>
        </div>
      </div>
      {adding ? <Collection key={`add-${selected}`} kind="library" state={state} notify={notify} addToPlaylist={current.id} onPlaylistChange={changed} /> : <Collection key={selected} kind="library" state={state} notify={notify} playlistId={current.id} onPlaylistChange={changed} />}
    </div>}
  </section>;
}
