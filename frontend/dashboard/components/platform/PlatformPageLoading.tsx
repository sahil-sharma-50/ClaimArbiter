export function PlatformPageLoading({ label = "Loading…" }: { label?: string }) {
  return <p className="platform-page-intro">{label}</p>;
}
