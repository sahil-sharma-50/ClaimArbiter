import {
  BRANDMARK_PATHS,
  BRANDMARK_STROKE_WIDTH,
  BRANDMARK_VIEWBOX,
} from "@/landing-page/lib/brandmark-paths";

/**
 * ClaimArbiter brandmark — doodle robot (SVGRepo), tinted with the theme accent.
 * Favicon copies live at app/icon.svg + apple-icon.tsx with hardcoded gold.
 */
export function Brandmark({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRANDMARK_VIEWBOX}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <g
        stroke="var(--accent-strong)"
        strokeWidth={BRANDMARK_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {BRANDMARK_PATHS.map((d) => (
          <path key={d.slice(0, 28)} d={d} />
        ))}
      </g>
    </svg>
  );
}
