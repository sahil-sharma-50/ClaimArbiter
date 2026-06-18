import type { ReactNode } from "react";

export function PlatformPageKicker({
  children,
  tone,
  live,
}: {
  children: ReactNode;
  /** Optional CSS color for kicker + dot (e.g. brief status tone on Overview). */
  tone?: string;
  live?: boolean;
}) {
  return (
    <p
      className="platform-page-kicker"
      style={tone ? { ["--kicker-tone" as string]: tone } : undefined}
    >
      <span className="platform-page-kicker-dot" data-live={live || undefined} aria-hidden />
      {children}
    </p>
  );
}
