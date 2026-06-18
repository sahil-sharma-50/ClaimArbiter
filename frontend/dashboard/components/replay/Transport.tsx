import { Pause, Play, RotateCcw } from "lucide-react";
import { Icon } from "@/dashboard/components/ui/Icon";

/*
  Presentational transport bar for the replay player. Holds no state of its own —
  the ReplayPlayer owns the clock and feeds elapsed/playing in. Restart, play/pause,
  a scrub slider, and a small time readout.
*/
export function Transport({
  playing,
  elapsed,
  duration,
  onPlayPause,
  onSeek,
  onRestart,
}: {
  playing: boolean;
  elapsed: number;
  duration: number;
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onRestart: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--inset)] px-3 py-2">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
        onClick={onRestart}
        aria-label="Restart replay"
      >
        <Icon as={RotateCcw} size={15} />
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-soft)] transition-colors hover:text-[var(--text)]"
        onClick={onPlayPause}
        aria-label={playing ? "Pause replay" : "Play replay"}
      >
        <Icon as={playing ? Pause : Play} size={15} />
      </button>
      <input
        type="range"
        className="flex-1 accent-[var(--accent)]"
        min={0}
        max={duration}
        value={elapsed}
        step={100}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Scrub replay"
      />
      <span className="label whitespace-nowrap font-[family-name:var(--font-mono)]">
        {Math.round(elapsed / 1000)}s / {Math.round(duration / 1000)}s
      </span>
    </div>
  );
}
