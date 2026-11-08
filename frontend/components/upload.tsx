"use client";
import { useRef, useState } from "react";
import {
  UploadCloud,
  FileAudio,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { fa, errorText } from "@/lib/api";
import { uploadBatch, type UploadResult } from "@/lib/upload";
export default function Upload({ name }: { name: string }) {
  const input = useRef<HTMLInputElement>(null),
    busy = useRef(false);
  const [files, setFiles] = useState<File[]>([]),
    [pending, setPending] = useState(false),
    [artist, setArtist] = useState(""),
    [results, setResults] = useState<UploadResult[]>([]),
    [index, setIndex] = useState(0),
    [status, setStatus] = useState(""),
    [drag, setDrag] = useState(false);
  function select(list: File[]) {
    if (busy.current) return;
    setFiles(list);
    setResults([]);
    setStatus("");
  }
  async function start() {
    if (busy.current || !files.length) return;
    busy.current = true;
    setPending(true);
    setResults([]);
    setStatus("");
    try {
      await uploadBatch(
        files,
        (r) => setResults((old) => [...old, r]),
        setIndex,
        undefined,
        artist,
      );
      setStatus("آپلود تمام شد؛ نتیجهٔ هر فایل را این پایین ببین.");
      setFiles([]);
      if (input.current) input.current.value = "";
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section className="upload-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">سهم تو از حال خوب</span>
          <h2>آهنگ بعدی، انتخاب تو.</h2>
        </div>
        <span className="chip">
          <FileAudio size={16} /> MP3
        </span>
      </div>
      <p className="muted">
        یک آهنگ یا چند آهنگ را با نام «{name}» به آرشیو و صف پخش اضافه کن.
      </p>
      <label className="artist-upload-label" htmlFor="upload-artist">خواننده (اختیاری؛ برای همهٔ فایل‌های انتخابی)</label>
      <input id="upload-artist" value={artist} maxLength={120} disabled={pending} onChange={(e) => setArtist(e.target.value)} placeholder="خالی بگذار تا از اطلاعات هر فایل خوانده شود" />
      <label
        className={`dropzone ${drag ? "dragging" : ""} ${pending ? "disabled" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          select(Array.from(e.dataTransfer.files));
        }}
      >
        <span className="upload-symbol">
          <UploadCloud size={36} />
        </span>
        <strong>موسیقی‌ات را اینجا رها کن</strong>
        <span>یا برای انتخاب فایل‌ها کلیک کن</span>
        <small>انتخاب چندتایی · فایل MP3 · بدون سقف حجم</small>
        <input
          ref={input}
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
          disabled={pending}
          onChange={(e) => select(Array.from(e.target.files ?? []))}
          aria-label="انتخاب فایل‌های MP3"
        />
      </label>
      {files.length > 0 && (
        <div className="selected-files">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`}>
              <FileAudio size={17} />
              <span dir="auto">{file.name}</span>
              <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
              <button
                className="icon-button"
                aria-label={`برداشتن ${file.name}`}
                disabled={pending}
                onClick={() => setFiles((old) => old.filter((_, n) => n !== i))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        className="primary"
        disabled={pending || !files.length}
        onClick={start}
      >
        <UploadCloud size={18} />
        {pending
          ? `در حال افزودن ${fa(index + 1)} از ${fa(files.length)}`
          : files.length
            ? `افزودن ${fa(files.length)} آهنگ به صف`
            : "ابتدا آهنگ انتخاب کن"}
      </button>
      {pending && (
        <progress
          className="upload-progress"
          value={results.length}
          max={files.length}
          aria-label="پیشرفت آپلود"
        />
      )}
      <p role="status" className="muted">
        {status}
      </p>
      <ul className="upload-results">
        {results.map((r, i) => (
          <li key={i} className={r.status}>
            {r.status === "success" ? (
              <CheckCircle2 size={18} />
            ) : (
              <AlertCircle size={18} />
            )}
            <span>
              <bdi>{r.name}</bdi>
              <small>{r.message}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
