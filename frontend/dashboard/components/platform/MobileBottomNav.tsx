"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import {
  IconDashboard,
  IconLive,
  IconNew,
} from "@/dashboard/components/platform/icons";
import {
  isNavItemActive,
  PLATFORM_BOTTOM_NAV,
  type PlatformNavItem,
} from "@/dashboard/lib/platformNav";

function bottomIcon(item: PlatformNavItem) {
  switch (item.href) {
    case "/app":
      return <IconDashboard />;
    case "/app/live":
      return <IconLive />;
    case "/app/new":
      return <IconNew />;
    default:
      return null;
  }
}

export function MobileBottomNav({
  pathname,
  onMenuOpen,
}: {
  pathname: string;
  onMenuOpen: () => void;
}) {
  return (
    <nav className="platform-bottom-nav" aria-label="Quick navigation">
      {PLATFORM_BOTTOM_NAV.map((item) => {
        const active = isNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`platform-bottom-nav-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
          >
            <span className="platform-bottom-nav-icon" aria-hidden>
              {bottomIcon(item)}
            </span>
            <span className="platform-bottom-nav-label">{item.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        className="platform-bottom-nav-item"
        onClick={onMenuOpen}
        aria-label="Open full menu"
      >
        <span className="platform-bottom-nav-icon" aria-hidden>
          <Menu size={20} strokeWidth={1.75} />
        </span>
        <span className="platform-bottom-nav-label">Menu</span>
      </button>
    </nav>
  );
}
