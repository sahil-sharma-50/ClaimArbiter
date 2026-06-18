"use client";

import { useEffect } from "react";

/**
 * Adds `.in-view` to every `.on-scroll` element as it enters the viewport,
 * driving CSS scroll-reveal transitions. Respects prefers-reduced-motion by
 * revealing everything immediately.
 */
export function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".on-scroll"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in-view", "reveal-done"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const el = e.target as HTMLElement;
            el.classList.add("in-view");
            io.unobserve(el);
            // Drop will-change once the reveal transition has finished so we
            // stop holding a compositor layer for every revealed block.
            const done = () => el.classList.add("reveal-done");
            el.addEventListener("transitionend", done, { once: true });
            window.setTimeout(done, 900);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}
