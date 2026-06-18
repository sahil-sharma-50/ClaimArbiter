"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PlatformMenuButton } from "@/dashboard/components/platform/PlatformMenuButton";
import { useFocusTrap } from "@/dashboard/lib/useFocusTrap";

const DRAWER_ID = "landing-nav-drawer";

type Section = { id: string; label: string };

export function LandingMobileMenu({
  sections,
  activeSection,
}: {
  sections: readonly Section[];
  activeSection: string;
}) {
  const [open, setOpen] = useState(false);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const isMobile = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(max-width: 767px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(max-width: 767px)").matches,
    () => false,
  );

  useFocusTrap(drawerRef, open && isMobile);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) menuBtnRef.current?.focus();
  }, [open]);

  if (!isMobile) return null;

  return (
    <>
      <PlatformMenuButton
        ref={menuBtnRef}
        open={open}
        controlsId={DRAWER_ID}
        onClick={() => setOpen((v) => !v)}
        labelOpen="Open page menu"
        labelClose="Close page menu"
      />
      <button
        type="button"
        className={`landing-nav-backdrop${open ? " is-visible" : ""}`}
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside
        ref={drawerRef}
        id={DRAWER_ID}
        className={`landing-nav-drawer${open ? " is-open" : ""}`}
        aria-label="Page menu"
        {...(open ? {} : { inert: true })}
      >
        <div className="landing-nav-drawer-head">
          <span className="landing-nav-drawer-title">Menu</span>
          <button
            type="button"
            className="landing-nav-drawer-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            Close
          </button>
        </div>
        <nav className="landing-nav-drawer-links" aria-label="Page sections">
          <ul>
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="landing-nav-drawer-link"
                  aria-current={activeSection === s.id ? "true" : undefined}
                  onClick={() => setOpen(false)}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="landing-nav-drawer-foot">
          <Link href="/app" className="btn btn-accent group w-full justify-center py-3" onClick={() => setOpen(false)}>
            Open console
          </Link>
        </div>
      </aside>
    </>
  );
}
