/** Scroll behavior that respects prefers-reduced-motion. */
export function landingScrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Reveal every `.on-scroll` block inside a container. */
export function revealOnScrollIn(root: ParentNode) {
  root.querySelectorAll<HTMLElement>(".on-scroll").forEach((el) => {
    el.classList.add("in-view", "reveal-done");
  });
}

const LANDING_SECTION_IDS = ["problem", "how", "architecture", "why-band", "payoff"] as const;

function landingSectionForHash(hash: string): string | null {
  for (const id of LANDING_SECTION_IDS) {
    if (hash === id || hash.startsWith(`${id}-`)) return id;
  }
  return null;
}

export function isManagedLandingHash(hash: string): boolean {
  return landingSectionForHash(hash.replace(/^#/, "")) !== null;
}

/** Scroll to an in-page hash target (section or deep link such as #how-step-4). */
export function scrollToLandingHash(hash: string) {
  const id = hash.replace(/^#/, "");
  if (!id) return;

  requestAnimationFrame(() => {
    const target = document.getElementById(id);
    const behavior = landingScrollBehavior();
    if (target) {
      target.scrollIntoView({ behavior, block: "start" });
      revealOnScrollIn(target.closest("section") ?? target);
      return;
    }
    const sectionId = landingSectionForHash(id);
    if (sectionId) {
      const section = document.getElementById(sectionId);
      section?.scrollIntoView({ behavior, block: "start" });
      if (section) revealOnScrollIn(section);
    }
  });
}
