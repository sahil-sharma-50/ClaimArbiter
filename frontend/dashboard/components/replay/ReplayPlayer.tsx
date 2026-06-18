"use client";

import { useEffect, useRef, useState } from "react";
import { Stage } from "@/dashboard/components/Stage";
import { Transport } from "@/dashboard/components/replay/Transport";
import { frameAt, replayDuration, type Replay } from "@/dashboard/lib/replay";

/*
  Drives the real live render tree (Stage) from a recorded ArbiterState timeline.
  The clock advances `elapsed` by real wall-clock delta; frameAt() resolves the
  state to show. No scene logic lives here — we render the same Stage the live
  console does, in readOnly mode with no-op handlers.
*/
export function ReplayPlayer({
  replay,
  autoLoop = false,
  scaled = false,
}: {
  replay: Replay;
  autoLoop?: boolean;
  scaled?: boolean;
}) {
  const duration = replayDuration(replay);

  // Honor reduced-motion: skip the clock entirely and show the final frame.
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const [elapsed, setElapsed] = useState(reduceMotion ? duration : 0);
  const [playing, setPlaying] = useState(!reduceMotion);

  // rAF loop: advance elapsed by real delta while playing. Re-created whenever
  // `playing` toggles; cleaned up on unmount.
  const lastTs = useRef<number | null>(null);
  useEffect(() => {
    if (reduceMotion || !playing) return;
    let raf = 0;
    lastTs.current = null;
    const tick = (now: number) => {
      const prev = lastTs.current;
      lastTs.current = now;
      if (prev != null) {
        const delta = now - prev;
        setElapsed((cur) => {
          const next = cur + delta;
          if (next >= duration) {
            if (autoLoop) return 0;
            setPlaying(false);
            return duration;
          }
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastTs.current = null;
    };
  }, [playing, reduceMotion, autoLoop, duration]);

  const state = frameAt(replay, elapsed);
  const phase = state?.phase ?? "idle";

  const noop = () => {};

  return (
    <div className={scaled ? "replay-scaled" : undefined}>
      <Stage
        state={state}
        phase={phase}
        chatId={state?.chat_id ?? null}
        degraded={false}
        onRun={noop}
        seeding={false}
        onAction={noop}
        readOnly
        viewing={null}
      />
      {!autoLoop && (
        <Transport
          playing={playing}
          elapsed={elapsed}
          duration={duration}
          onPlayPause={() => setPlaying((p) => !p)}
          onSeek={(ms) => setElapsed(ms)}
          onRestart={() => {
            setElapsed(0);
            setPlaying(true);
          }}
        />
      )}
    </div>
  );
}
