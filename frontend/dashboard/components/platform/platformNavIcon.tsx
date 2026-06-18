import type { ReactNode } from "react";
import {
  IconAgents,
  IconDashboard,
  IconLive,
  IconNew,
  IconSessions,
  IconSettings,
} from "@/dashboard/components/platform/icons";

export function platformNavIcon(href: string): ReactNode {
  switch (href) {
    case "/app":
      return <IconDashboard />;
    case "/app/new":
      return <IconNew />;
    case "/app/live":
      return <IconLive />;
    case "/app/sessions":
      return <IconSessions />;
    case "/app/agents":
      return <IconAgents />;
    case "/app/settings":
      return <IconSettings />;
    default:
      return null;
  }
}
