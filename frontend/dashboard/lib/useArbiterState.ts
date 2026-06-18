"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchState, GatewayError, seedDemo, type ArbiterState, type ClaimPreset } from "@/dashboard/lib/api";
import { mockState, readMockParam } from "@/dashboard/lib/mock";
import { recordSession, updateSessionPhase } from "@/dashboard/lib/sessions";
import { appendFrame, type ReplayFrame } from "@/dashboard/lib/replay";

export type ConnState = "idle" | "live" | "error" | "seeding";

export type ArbiterStore = {
  state: ArbiterState | null;
  phase: string;
  conn: ConnState;
  chatId: string | null;
  degraded: boolean;
  /**
   * True when the gateway reports this chat_id is unknown to Band (HTTP 404) — a
   * stale/dead room left in the URL. Distinct from `degraded` (a transient reach
   * failure): the live console redirects to the claim picker rather than letting
   * the operator act on a room that no longer exists.
   */
  notFound: boolean;
  runDemo: (claimType?: ClaimPreset["id"]) => Promise<string | null>;
  refresh: () => Promise<void>;
  /**
   * Only present when the page is opened with `?capture=1` (a dev/demo affordance).
   * Serializes the recorded frames to a JSON file and triggers a browser download.
   * Undefined in normal use so the store shape is unchanged for live visitors.
   */
  downloadReplay?: () => void;
};

/**
 * Opt-in replay capture, mirroring `readMockParam`'s window-guard so it's evaluated
 * once and is a no-op for real visitors. Returns true ONLY when the URL has
 * `?capture=1` and we're not in a production build.
 */
function readCaptureParam(): boolean {
  if (typeof window === "undefined") return false;
  if (process.env.NODE_ENV === "production") return false;
  return new URLSearchParams(window.location.search).get("capture") === "1";
}

export function useArbiterState(initialChatId?: string | null): ArbiterStore {
  const [state, setState] = useState<ArbiterState | null>(null);
  const [conn, setConn] = useState<ConnState>("idle");
  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
  const [degraded, setDegraded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const mockRef = useRef(readMockParam());
  const chatRef = useRef<string | null>(initialChatId ?? null);

  // Replay capture: evaluated once via lazy init. Stays false in normal use, so the
  // frames buffer never grows and no download wiring is exposed.
  const [captureEnabled] = useState(() => readCaptureParam());
  const framesRef = useRef<ReplayFrame[]>([]);
  const startRef = useRef<number | null>(null);

  const refresh = useCallback(async (force = false) => {
    const mock = mockRef.current;
    if (mock !== null) {
      if (mock === "error") {
        const lastGood = mockState("investigating");
        setState(lastGood);
        setChatId(lastGood.chat_id);
        chatRef.current = lastGood.chat_id;
        setConn("live");
        setDegraded(true);
        return;
      }
      const s = mockState(mock);
      setState(s);
      setChatId(s.chat_id);
      chatRef.current = s.chat_id;
      setConn(mock === "idle" ? "idle" : "live");
      setDegraded(false);
      return;
    }

    const activeChat = chatRef.current;
    if (!activeChat) {
      setState(null);
      setConn("idle");
      setDegraded(false);
      return;
    }

    try {
      const data = await fetchState(activeChat, force);
      setState(data);
      if (captureEnabled) {
        if (startRef.current === null) startRef.current = Date.now();
        framesRef.current = appendFrame(framesRef.current, data, Date.now() - startRef.current);
      }
      if (data.chat_id) {
        setChatId(data.chat_id);
        chatRef.current = data.chat_id;
        updateSessionPhase(data.chat_id, data.phase);
      }
      setConn(data.chat_id ? "live" : "idle");
      setDegraded(false);
      setNotFound(false);
    } catch (err) {
      // A 404 means Band doesn't know this chat_id — a stale/dead room in the URL,
      // not a transient outage. Flag it so the live page can redirect to the picker;
      // any other error is a reach failure that keeps the last-good view (degraded).
      if (err instanceof GatewayError && err.status === 404) {
        setNotFound(true);
        setConn("error");
        return;
      }
      setDegraded(true);
      setConn((prev) => (prev === "live" ? "live" : "error"));
    }
  }, [captureEnabled]);

  const runDemo = useCallback(async (claimType: ClaimPreset["id"] = "property"): Promise<string | null> => {
    if (mockRef.current !== null) return null;
    setConn("seeding");
    try {
      const { chat_id } = await seedDemo(claimType);
      setChatId(chat_id);
      chatRef.current = chat_id;
      recordSession(chat_id);
      await refresh(true);
      return chat_id;
    } catch {
      setConn("error");
      setDegraded(true);
      return null;
    }
  }, [refresh]);

  const downloadReplay = useCallback(() => {
    if (typeof window === "undefined") return;
    const id = chatRef.current ?? "property";
    const replay = { id, label: "property", frames: framesRef.current };
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay-${id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    refresh(true);
    if (mockRef.current !== null) return;
    const timer = setInterval(() => refresh(false), 1500);
    return () => clearInterval(timer);
  }, [refresh]);

  return {
    state,
    phase: state?.phase ?? "idle",
    conn,
    chatId,
    degraded,
    notFound,
    runDemo,
    refresh: () => refresh(true),
    downloadReplay: captureEnabled ? downloadReplay : undefined,
  };
}
