import type { ArbiterState } from "@/dashboard/lib/api";

export type ReplayFrame = { t: number; state: ArbiterState };
export type Replay = { id: string; label: string; frames: ReplayFrame[] };

/** Append a frame only if the phase or audit length changed (dedupe steady state). */
export function appendFrame(frames: ReplayFrame[], state: ArbiterState, tMs: number): ReplayFrame[] {
  const last = frames[frames.length - 1];
  if (last && last.state.phase === state.phase && last.state.audit.length === state.audit.length) {
    return frames;
  }
  return [...frames, { t: tMs, state }];
}

/** The frame whose timestamp is <= elapsed; for scrubbing. Falls back to first frame. */
export function frameAt(replay: Replay, elapsedMs: number): ArbiterState | null {
  let cur: ArbiterState | null = null;
  for (const f of replay.frames) {
    if (f.t <= elapsedMs) cur = f.state;
    else break;
  }
  return cur ?? replay.frames[0]?.state ?? null;
}

/** Total duration of a replay in ms (timestamp of the last frame). */
export function replayDuration(replay: Replay): number {
  return replay.frames.length ? replay.frames[replay.frames.length - 1].t : 0;
}
