"use client";

import { useRef, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { fetchHealth } from "@/dashboard/lib/api";
import { Sidebar } from "@/dashboard/components/platform/Sidebar";
import { PlatformTopBar } from "@/dashboard/components/platform/PlatformTopBar";
import { PlatformGridBackdrop } from "@/dashboard/components/platform/PlatformGridBackdrop";
import { MobileBottomNav } from "@/dashboard/components/platform/MobileBottomNav";
import { PlatformSyncProvider } from "@/dashboard/components/platform/PlatformSyncContext";
import { useFocusTrap } from "@/dashboard/lib/useFocusTrap";

function subscribeMobileNav(onStoreChange: () => void) {
  const mq = window.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getMobileNav() {
  return window.matchMedia("(max-width: 767px)").matches;
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gatewayOk, setGatewayOk] = useState<boolean | null>(null);
  const [keysRequired, setKeysRequired] = useState<boolean>(false);
  const [navOpen, setNavOpen] = useState(false);
  const isMobileNav = useSyncExternalStore(subscribeMobileNav, getMobileNav, () => false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useFocusTrap(drawerRef, navOpen && isMobileNav);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const h = await fetchHealth();
      if (!cancelled) {
        setGatewayOk(h.ok);
        setKeysRequired(Boolean(h.keys_required));
      }
    }
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  useEffect(() => {
    if (!navOpen && isMobileNav) menuBtnRef.current?.focus();
  }, [navOpen, isMobileNav]);

  const closeNav = () => setNavOpen(false);
  const toggleNav = () => setNavOpen((v) => !v);

  return (
    <PlatformSyncProvider gatewayOk={gatewayOk} keysRequired={keysRequired}>
      <PlatformGridBackdrop>
        <div className={`platform-shell${navOpen ? " nav-open" : ""}`}>
          <a href="#platform-main" className="skip-link platform-skip-link">
            Skip to content
          </a>
          <PlatformTopBar
            pathname={pathname}
            menuOpen={navOpen}
            menuBtnRef={menuBtnRef}
            onMenuToggle={toggleNav}
          />
          <button
            type="button"
            className="platform-nav-backdrop"
            aria-label="Close menu"
            tabIndex={navOpen ? 0 : -1}
            onClick={closeNav}
          />
          <Sidebar
            ref={drawerRef}
            pathname={pathname}
            gatewayOk={gatewayOk}
            mobileOpen={navOpen}
            onNavigate={closeNav}
            onClose={closeNav}
            inert={isMobileNav && !navOpen}
          />
          <div className="platform-main">
            <div id="platform-main" className="platform-content" tabIndex={-1}>
              {children}
            </div>
          </div>
          <MobileBottomNav pathname={pathname} onMenuOpen={() => setNavOpen(true)} />
        </div>
      </PlatformGridBackdrop>
    </PlatformSyncProvider>
  );
}
