"use client";

import { useEffect, useState, type RefObject } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Brandmark } from "@/landing-page/components/Brandmark";
import { PlatformMenuButton } from "@/dashboard/components/platform/PlatformMenuButton";
import { SyncIndicator } from "@/dashboard/components/platform/SyncIndicator";
import { platformNavIcon } from "@/dashboard/components/platform/platformNavIcon";
import { computeLiveStatsFromRecords, mergeClaimsWithSessions } from "@/dashboard/lib/sessions";
import { usePlatformSync } from "@/dashboard/lib/usePlatformSync";
import {
  isNavItemActive,
  PLATFORM_NAV_ANCHOR_END,
  PLATFORM_NAV_ANCHOR_START,
  PLATFORM_NAV_DRAWER_ID,
  PLATFORM_NAV_OPS,
  type PlatformNavItem,
  type PlatformNavZone,
} from "@/dashboard/lib/platformNav";

export function PlatformTopBar({
  pathname,
  menuOpen = false,
  menuBtnRef,
  onMenuToggle,
}: {
  pathname: string;
  menuOpen?: boolean;
  menuBtnRef?: RefObject<HTMLButtonElement | null>;
  onMenuToggle?: () => void;
}) {
  const { sessions, claims } = usePlatformSync();
  // The live indicator derives from localStorage-backed sessions, which are empty on
  // the server but present on the first client render — rendering it before mount
  // causes a hydration mismatch (the server omits the live dot, the client adds it).
  // Gate it on a post-mount flag so SSR and the first client paint are identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const claimsInFlight =
    mounted &&
    computeLiveStatsFromRecords(mergeClaimsWithSessions(claims, sessions)).inFlight > 0;

  return (
    <header className="platform-topbar">
      <div className="platform-topbar-frame">
        <div className="platform-topbar-masthead">
          <div className="platform-topbar-upper">
            <div className="platform-topbar-brand-zone">
              <PlatformMenuButton
                ref={menuBtnRef}
                open={menuOpen}
                controlsId={PLATFORM_NAV_DRAWER_ID}
                onClick={() => onMenuToggle?.()}
              />
              <Link href="/app" className="platform-topbar-brand" aria-label="ClaimArbiter console home">
                <Brandmark size={40} className="platform-topbar-mark" />
                <span className="platform-topbar-brand-text">
                  <span className="platform-brand-name">
                    Claim<span className="platform-brand-accent">Arbiter</span>
                  </span>
                  <span className="platform-topbar-console-tag">Console</span>
                </span>
              </Link>
            </div>

            <nav className="platform-topbar-channels" aria-label="Platform navigation">
              <ul className="platform-topbar-nav">
                <TopNavLink
                  item={PLATFORM_NAV_ANCHOR_START}
                  pathname={pathname}
                  zone="anchor"
                  claimsInFlight={claimsInFlight}
                />
                {PLATFORM_NAV_OPS.map((item) => (
                  <TopNavLink
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    zone="ops"
                    claimsInFlight={claimsInFlight}
                  />
                ))}
                <TopNavLink
                  item={PLATFORM_NAV_ANCHOR_END}
                  pathname={pathname}
                  zone="anchor"
                  claimsInFlight={claimsInFlight}
                />
              </ul>
            </nav>

            <div className="platform-topbar-utilities" aria-label="Console utilities">
              <Link href="/" className="platform-topbar-exit" aria-label="To the Overview">
                <ArrowLeft size={16} strokeWidth={1.75} aria-hidden />
                <span>To the Overview</span>
              </Link>
              <SyncIndicator />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function TopNavLink({
  item,
  pathname,
  zone,
  claimsInFlight,
}: {
  item: PlatformNavItem;
  pathname: string;
  zone: PlatformNavZone;
  claimsInFlight: boolean;
}) {
  const active = isNavItemActive(pathname, item);
  const isLiveTab = item.href === "/app/live";
  const showLiveDot = isLiveTab && claimsInFlight;
  const liveWatching = isLiveTab && active && claimsInFlight;

  const className = [
    "platform-topbar-channel",
    `platform-topbar-channel--${zone}`,
    active ? "is-active" : "",
    showLiveDot ? "is-live" : "",
    liveWatching ? "is-live-watching" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li>
      <Link
        href={item.href}
        className={className}
        aria-current={active ? "page" : undefined}
        aria-label={showLiveDot && !active ? `${item.label}, claim in flight` : undefined}
      >
        <span className="platform-nav-icon" aria-hidden>
          {platformNavIcon(item.href)}
        </span>
        <span className="platform-nav-tab-label">{item.label}</span>
        {showLiveDot ? <span className="platform-nav-live-dot" aria-hidden /> : null}
      </Link>
    </li>
  );
}
