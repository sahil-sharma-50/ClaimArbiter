import type { LucideIcon } from "lucide-react";

/**
 * Single icon entry point so the whole app uses one system (lucide) at one
 * size/stroke. Pass any lucide icon as `as`. Defaults match the instrument feel.
 */
export function Icon({
  as: Glyph,
  size = 16,
  className,
  strokeWidth = 1.75,
  "aria-label": ariaLabel,
}: {
  as: LucideIcon;
  size?: number;
  className?: string;
  strokeWidth?: number;
  "aria-label"?: string;
}) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
    />
  );
}
