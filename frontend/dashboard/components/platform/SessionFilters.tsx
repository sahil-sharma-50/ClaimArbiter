import type { SessionFilter } from "@/dashboard/lib/sessions";

const FILTERS: { key: SessionFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in_progress", label: "In progress" },
  { key: "escalated", label: "Awaiting sign-off" },
  { key: "completed", label: "Completed" },
];

export function SessionFilters({
  active,
  onChange,
}: {
  active: SessionFilter;
  onChange: (f: SessionFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter sessions">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          type="button"
          role="tab"
          aria-selected={active === f.key}
          className={`filter-chip${active === f.key ? " is-active" : ""}`}
          onClick={() => onChange(f.key)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
