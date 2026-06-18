"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Reports whether the referenced element is currently in the viewport, so
 * looping animations (transmission band, architecture diagram) can pause when
 * scrolled away. Attach the returned ref to the element you want to observe.
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(rootMargin = "0px") {
  const ref = useRef<T>(null);
  const hasObserver = useSyncExternalStore(
    () => () => {},
    () => typeof IntersectionObserver !== "undefined",
    () => false,
  );
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!hasObserver) return;
    // threshold 0 → in-view the instant ANY pixel is visible, so a hero element
    // that's only partially below the fold on load still starts its loop. The
    // gate's only job is to pause when fully scrolled away (isIntersecting=false),
    // not to wait until the element is substantially on screen.
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasObserver, rootMargin]);

  return { ref, inView: hasObserver ? inView : true };
}
