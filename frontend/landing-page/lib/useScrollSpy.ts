"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks which section is currently in view and returns its id, so nav links,
 * the mobile pill rail, and the desktop mini-TOC can all share one active
 * state. Uses a single IntersectionObserver keyed to the vertical center of
 * the viewport. Also reports whether the user has scrolled past the hero, so
 * the mini-TOC can fade in only once it's useful.
 */
export function useScrollSpy(ids: string[]) {
  const [active, setActive] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const pastHeroRef = useRef(false);

  useEffect(() => {
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    const heroThreshold = () => window.innerHeight * 0.8;

    const syncPastHero = () => {
      const pastHero = window.scrollY > heroThreshold();
      pastHeroRef.current = pastHero;
      setScrolled(pastHero);
      if (!pastHero) setActive("");
      return pastHero;
    };

    // Track the most-visible section. rootMargin pulls the detection band
    // toward the upper-middle so a section counts as "active" when its heading
    // reaches roughly the top third of the viewport.
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        if (!pastHeroRef.current) {
          setActive("");
          return;
        }
        let best = "";
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            best = id;
            bestRatio = ratio;
          }
        }
        setActive(best);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.01, 0.25, 0.5, 0.75] },
    );

    sections.forEach((s) => io.observe(s));

    const onScroll = () => syncPastHero();
    syncPastHero();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [ids]);

  return { active, scrolled };
}
