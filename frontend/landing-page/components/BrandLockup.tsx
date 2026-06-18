import Link from "next/link";
import { Brandmark } from "@/landing-page/components/Brandmark";

/**
 * ClaimArbiter logo lockup: doodle robot brandmark + wordmark.
 */
export function BrandLockup({
  size = 28,
  href,
  wordmarkClassName = "",
  onClick,
  ariaLabel = "ClaimArbiter home",
}: {
  size?: number;
  href?: string;
  wordmarkClassName?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      <span className="inline-flex items-center justify-center" aria-hidden>
        <Brandmark size={size} />
      </span>
      <span
        className={`font-[family-name:var(--font-display)] ${wordmarkClassName || "text-2xl"} font-bold tracking-[-0.02em] text-[var(--text)]`}
      >
        Claim<span className="text-[var(--accent-strong)]">Arbiter</span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} className="flex items-center gap-1.5" aria-label={ariaLabel}>
        {inner}
      </Link>
    );
  }
  return <span className="flex items-center gap-1.5">{inner}</span>;
}
