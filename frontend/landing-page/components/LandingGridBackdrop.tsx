"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";

function subscribeReduceMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const DEFAULT_X = 50;
const DEFAULT_Y = 50;

function maskAt(x: number, y: number) {
  return `radial-gradient(ellipse 46vmin 42vmin at ${x}% ${y}%, black 28%, transparent 74%)`;
}

export function LandingGridBackdrop({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useSyncExternalStore(subscribeReduceMotion, getReduceMotion, () => false);
  const isClient = useSyncExternalStore(() => () => {}, () => true, () => false);
  const targetRef = useRef({ x: DEFAULT_X, y: DEFAULT_Y });
  const currentRef = useRef({ x: DEFAULT_X, y: DEFAULT_Y });
  const rafRef = useRef<number | null>(null);

  const applyVars = useCallback((x: number, y: number) => {
    const el = gridRef.current;
    if (!el) return;
    const mask = maskAt(x, y);
    el.style.setProperty("--grid-x", `${x}%`);
    el.style.setProperty("--grid-y", `${y}%`);
    el.style.setProperty("--grid-shift-x", `${(x / 100 - 0.5) * 28}px`);
    el.style.setProperty("--grid-shift-y", `${(y / 100 - 0.5) * 20}px`);
    el.style.maskImage = mask;
    el.style.webkitMaskImage = mask;
  }, []);

  const scheduleTick = useCallback(() => {
    if (rafRef.current != null) return;
    const run = () => {
      const cur = currentRef.current;
      const tgt = targetRef.current;
      cur.x += (tgt.x - cur.x) * 0.14;
      cur.y += (tgt.y - cur.y) * 0.14;
      applyVars(cur.x, cur.y);
      if (Math.abs(tgt.x - cur.x) > 0.08 || Math.abs(tgt.y - cur.y) > 0.08) {
        rafRef.current = requestAnimationFrame(run);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(run);
  }, [applyVars]);

  const attachGrid = useCallback(
    (node: HTMLDivElement | null) => {
      gridRef.current = node;
      if (node) applyVars(currentRef.current.x, currentRef.current.y);
    },
    [applyVars],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (isClient) applyVars(currentRef.current.x, currentRef.current.y);
  }, [isClient, applyVars]);

  useEffect(() => {
    if (reduceMotion) return;

    const onMove = (e: MouseEvent) => {
      targetRef.current = {
        x: (e.clientX / window.innerWidth) * 100,
        y: (e.clientY / window.innerHeight) * 100,
      };
      scheduleTick();
    };

    const onLeave = () => {
      targetRef.current = { x: DEFAULT_X, y: DEFAULT_Y };
      scheduleTick();
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [reduceMotion, scheduleTick]);

  return (
    <div className="landing-grid-backdrop relative">
      {isClient ? (
        <div
          ref={attachGrid}
          className="landing-grid"
          aria-hidden
          style={{
            ["--grid-x" as string]: `${DEFAULT_X}%`,
            ["--grid-y" as string]: `${DEFAULT_Y}%`,
            ["--grid-shift-x" as string]: "0px",
            ["--grid-shift-y" as string]: "0px",
          }}
        />
      ) : null}
      <div className="landing-grid-content relative z-10">{children}</div>
    </div>
  );
}
