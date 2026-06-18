import type { ReactNode } from "react";

/** Static mission-control grid behind the console shell (no cursor tracking). */
export function PlatformGridBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="platform-grid-shell">
      <div className="platform-grid" aria-hidden />
      <div className="platform-grid-content">{children}</div>
    </div>
  );
}
