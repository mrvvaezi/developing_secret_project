import { ListMusic, ChevronUp, ChevronDown, X } from "lucide-react";
import { fa, fmt } from "@/lib/api";
import type { RoomState } from "@/lib/types";
import Artwork from "./artwork";
export type Control = (
  action: string,
  extra?: Record<string, unknown>,
) => Promise<void>;
export default function Queue({
  state,
  token,
  control,
  pending,
  compact = false,
}: {
  state: RoomState | null;
  token: string;
  control: Control;
  pending: boolean;
  compact?: boolean;
}) {
  const tracks = compact ? state?.queue.slice(0, 5) : state?.queue;
  return (
    <section className="queue-panel">
      <div className="section-heading">
        <h2>
          <ListMusic size={20} /> بعدی‌های اتاق{" "}
          <span className="count">{fa(state?.queue.length ?? 0)}</span>
        </h2>
      </div>
      <p className="muted small">
        {state?.shuffle
          ? "پخش تصادفی روشن است؛ جابه‌جایی، آن را خاموش می‌کند."
          : "به ترتیب انتخاب‌های شما"}
      </p>
      <div className="queue-list">
        {!tracks?.length ? (
          <div className="empty">
            <ListMusic />
            <p>صف خالی است؛ انتخاب بعدی با تو.</p>
          </div>
        ) : (
          tracks.map((t, i) => (
            <article className="queue-row" key={t.id}>
              <span className="queue-number">{fa(i + 1).padStart(2, "۰")}</span>
              <Artwork seed={t.id} />
              <div className="queue-info">
                <h3 dir="auto">{t.title}</h3>
                <small>
                  {t.uploader} · <bdi>{fmt(t.duration)}</bdi>
                </small>
              </div>
              {i === 0 && !state?.shuffle && !token && (
                <span className="next-tag">بعدی</span>
              )}
              {token && (
                <div className="queue-actions">
                  <button
                    className="icon-button"
                    disabled={pending || i === 0}
                    onClick={() =>
                      void control("move", { track_id: t.id, direction: "up" })
                    }
                    aria-label={`بالا بردن ${t.title}`}
                  >
                    <ChevronUp size={17} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={pending || i === (state?.queue.length ?? 0) - 1}
                    onClick={() =>
                      void control("move", {
                        track_id: t.id,
                        direction: "down",
                      })
                    }
                    aria-label={`پایین بردن ${t.title}`}
                  >
                    <ChevronDown size={17} />
                  </button>
                  <button
                    className="icon-button danger"
                    disabled={pending}
                    onClick={() => void control("remove", { track_id: t.id })}
                    aria-label={`حذف ${t.title} از صف`}
                  >
                    <X size={17} />
                  </button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
