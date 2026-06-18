/*
  Platform nav icon set. Backed by lucide-react so the whole /app surface shares
  one consistent, professionally-drawn pack. We keep the IconX names and pass
  currentColor through (Lucide's default), so Sidebar and the garnet active-state
  recolor work unchanged. Rendered at 18px with a 1.75 stroke to stay crisp and
  projector-safe, matching the prior hand-drawn spec.
*/
import {
  ArrowLeft,
  Bot,
  FilePlus2,
  History,
  LayoutDashboard,
  Radio,
  Settings,
  type LucideProps,
} from "lucide-react";

type IconProps = LucideProps;

const DEFAULTS: LucideProps = {
  size: 20,
  strokeWidth: 1.75,
  "aria-hidden": true,
};

// Dashboard — control grid
export function IconDashboard(props: IconProps) {
  return <LayoutDashboard {...DEFAULTS} {...props} />;
}

// Live claim — broadcast / live signal
export function IconLive(props: IconProps) {
  return <Radio {...DEFAULTS} {...props} />;
}

// New claim — compose / file with plus
export function IconNew(props: IconProps) {
  return <FilePlus2 {...DEFAULTS} {...props} />;
}

// Sessions — history of records
export function IconSessions(props: IconProps) {
  return <History {...DEFAULTS} {...props} />;
}

// Agents — the org's Band agent directory
export function IconAgents(props: IconProps) {
  return <Bot {...DEFAULTS} {...props} />;
}

// Settings — gear
export function IconSettings(props: IconProps) {
  return <Settings {...DEFAULTS} {...props} />;
}

// Back arrow — return to landing
export function IconBack(props: IconProps) {
  return <ArrowLeft {...DEFAULTS} {...props} />;
}
