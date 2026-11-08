import type { CSSProperties } from "react";
import { Music2 } from "lucide-react";
export default function Artwork({
  seed = "musicroom",
  large = false,
  playing = false,
}: {
  seed?: string;
  large?: boolean;
  playing?: boolean;
}) {
  const hash = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0);
  return (
    <div
      className={`artwork art-${hash % 5} ${large ? "artwork-large" : ""} ${playing ? "spinning" : ""}`}
      style={{ "--turn": `${hash % 90}deg` } as CSSProperties}
      aria-hidden="true"
    >
      <div className="art-orbit" />
      <div className="art-disc">
        <div className="art-center">
          <Music2 />
        </div>
      </div>
      {large && (
        <>
          <span className="art-edition">
            MUSIC ROOM
            <br />
            COLLECTIVE SOUNDS
          </span>
          <span className="art-side">SIDE A · 33⅓ RPM</span>
        </>
      )}
    </div>
  );
}
