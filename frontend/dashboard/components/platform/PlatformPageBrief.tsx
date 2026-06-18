import type { ReactNode } from "react";
import { PlatformPageKicker } from "@/dashboard/components/platform/PlatformPageKicker";

export function PlatformPageBrief({
  kicker,
  title,
  sub,
  live,
  tone,
  actions,
}: {
  kicker: string;
  title: string;
  sub: ReactNode;
  live?: boolean;
  tone?: string;
  actions?: ReactNode;
}) {
  return (
    <header
      className="platform-page-brief dash-brief"
      style={tone ? { ["--brief-tone" as string]: tone } : undefined}
    >
      <div className="dash-brief-main">
        <PlatformPageKicker tone={tone} live={live}>
          {kicker}
        </PlatformPageKicker>
        <h1 className="dash-brief-title">{title}</h1>
        <p className="dash-brief-sub">{sub}</p>
      </div>
      {actions ? <div className="dash-brief-actions">{actions}</div> : null}
    </header>
  );
}
