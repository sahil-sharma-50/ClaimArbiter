"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Brandmark } from "@/landing-page/components/Brandmark";
import { IconBack } from "@/dashboard/components/platform/icons";
import { platformNavIcon } from "@/dashboard/components/platform/platformNavIcon";
import { isNavItemActive, PLATFORM_NAV, PLATFORM_NAV_DRAWER_ID, type PlatformNavItem } from "@/dashboard/lib/platformNav";

export const Sidebar = forwardRef<
  HTMLElement,
  {
    pathname: string;
    gatewayOk: boolean | null;
    mobileOpen?: boolean;
    onNavigate?: () => void;
    onClose?: () => void;
    inert?: boolean;
  }
>(function Sidebar(
  { pathname, gatewayOk, mobileOpen, onNavigate, onClose, inert },
  ref,
) {
  return (
    <aside
      ref={ref}
      id={PLATFORM_NAV_DRAWER_ID}
      className={`platform-sidebar${mobileOpen ? " is-open" : ""}`}
      aria-label="Platform navigation"
      {...(inert ? { inert: true } : {})}
    >
      <div className="platform-sidebar-drawer-head">
        <div className="platform-sidebar-brand">
          <Brandmark size={32} />
          <span className="platform-brand-name">
            Claim<span className="platform-brand-accent">Arbiter</span>
          </span>
        </div>
        <button
          type="button"
          className="platform-sidebar-close"
          onClick={onClose}
          aria-label="Close navigation menu"
        >
          <X size={18} strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Close</span>
        </button>
      </div>

      <nav className="platform-nav" aria-label="Platform">
        {PLATFORM_NAV.map((section) => (
          <div key={section.group} className="platform-nav-group">
            <span className="platform-nav-label">{section.group}</span>
            <ul>
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="platform-sidebar-footer">
        <Link href="/" className="platform-nav-item text-[12px]" onClick={onNavigate}>
          <span className="platform-nav-icon" aria-hidden>
            <IconBack />
          </span>
          Back to overview
        </Link>
        <div className="platform-status-row">
          <span
            className="pulse-dot"
            style={{
              background:
                gatewayOk === true
                  ? "var(--success)"
                  : gatewayOk === false
                    ? "var(--danger)"
                    : "var(--text-ghost)",
            }}
          />
          <span>
            {gatewayOk === true
              ? "All services online"
              : gatewayOk === false
                ? "Gateway offline"
                : "Checking…"}
          </span>
          <span className="platform-version">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
});

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: PlatformNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isNavItemActive(pathname, item);
  return (
    <li>
      <Link
        href={item.href}
        className={`platform-nav-item${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
      >
        <span className="platform-nav-icon" aria-hidden>
          {platformNavIcon(item.href)}
        </span>
        <span className="platform-nav-tab-label">{item.label}</span>
      </Link>
    </li>
  );
}
