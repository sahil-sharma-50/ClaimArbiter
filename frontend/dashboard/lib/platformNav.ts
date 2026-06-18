export type PlatformNavZone = "anchor" | "ops";

export type PlatformNavItem = {
  href: string;
  label: string;
  exact: boolean;
  zone: PlatformNavZone;
};

export type PlatformNavGroup = {
  group: string;
  items: PlatformNavItem[];
};

/** Primary routes surfaced in the mobile bottom bar. */
export const PLATFORM_BOTTOM_NAV: PlatformNavItem[] = [
  { href: "/app", label: "Overview", exact: true, zone: "anchor" },
  { href: "/app/live", label: "Live", exact: false, zone: "ops" },
  { href: "/app/new", label: "Intake", exact: false, zone: "ops" },
];

export const PLATFORM_NAV: PlatformNavGroup[] = [
  {
    group: "General",
    items: [{ href: "/app", label: "Overview", exact: true, zone: "anchor" }],
  },
  {
    group: "Operations",
    items: [
      { href: "/app/new", label: "Intake", exact: false, zone: "ops" },
      { href: "/app/live", label: "Live", exact: false, zone: "ops" },
      { href: "/app/sessions", label: "Sessions", exact: false, zone: "ops" },
      { href: "/app/agents", label: "Agents", exact: false, zone: "ops" },
    ],
  },
  {
    group: "Admin",
    items: [{ href: "/app/settings", label: "Config", exact: false, zone: "anchor" }],
  },
];

/** Flat list of all nav destinations (drawer, command palette, etc.). */
export const PLATFORM_NAV_FLAT: PlatformNavItem[] = PLATFORM_NAV.flatMap((group) => group.items);

/** Desk anchors — Overview (start) and Config (end). */
export const PLATFORM_NAV_ANCHOR_START = PLATFORM_NAV_FLAT.find((item) => item.href === "/app")!;
export const PLATFORM_NAV_ANCHOR_END = PLATFORM_NAV_FLAT.find((item) => item.href === "/app/settings")!;

/** Workflow channels — intake, live, sessions, agents. */
export const PLATFORM_NAV_OPS = PLATFORM_NAV_FLAT.filter((item) => item.zone === "ops");

export function isNavItemActive(pathname: string, item: Pick<PlatformNavItem, "href" | "exact">) {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export const PLATFORM_NAV_DRAWER_ID = "platform-nav-drawer";
