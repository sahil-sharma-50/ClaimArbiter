"use client";

import { forwardRef } from "react";
import { Menu, X } from "lucide-react";

type PlatformMenuButtonProps = {
  open: boolean;
  onClick: () => void;
  controlsId: string;
  labelOpen?: string;
  labelClose?: string;
};

export const PlatformMenuButton = forwardRef<HTMLButtonElement, PlatformMenuButtonProps>(
  function PlatformMenuButton(
    {
      open,
      onClick,
      controlsId,
      labelOpen = "Open navigation menu",
      labelClose = "Close navigation menu",
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        className="platform-menu-btn"
        onClick={onClick}
        aria-expanded={open}
        aria-controls={controlsId}
        aria-label={open ? labelClose : labelOpen}
      >
        <span className="platform-menu-icon" data-state={open ? "open" : "closed"} aria-hidden>
          <Menu size={20} strokeWidth={1.75} className="platform-menu-glyph platform-menu-glyph-menu" />
          <X size={20} strokeWidth={1.75} className="platform-menu-glyph platform-menu-glyph-close" />
        </span>
      </button>
    );
  },
);
