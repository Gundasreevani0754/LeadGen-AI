import { PageHeader } from "@/components/ui/page-header";
import { listLeads, type LeadFilters } from "@/lib/leads/queries";
import { getSettings } from "@/lib/settings";
import { FilterBar } from "./filter-bar";
import { LeadsTable } from "./leads-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const settings = await getSettings();

  const sort = pick(params.sort, ["score", "reviews", "rating", "name", "recent"], "score");
  const dir = pick(params.dir, ["asc", "desc"], "desc");
  const page = Math.max(1, Number(first(params.page) ?? 1) || 1);

  const filters: LeadFilters = {
    q: first(params.q),
    status: pick(
      params.status,
      [
        "new",
        "qualified",
        "contacted",
        "replied",
        "call_booked",
        "won",
        "dead",
        "all",
      ] as const,
      "all",
    ),
    entity: pick(params.entity, ["business", "service_provider", "all"] as const, "all"),
    tier: pick(
      params.tier,
      ["phone", "email", "linkedin", "social", "form", "none", "all"] as const,
      "all",
    ),
    briefed: pick(params.briefed, ["yes", "no", "all"] as const, "all"),
    minScore: numeric(first(params.min)),
    sort,
    dir,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const leads = await listLeads(filters);

  return (
    <>
      <PageHeader
        eyebrow="Leads"
        title="Everything scored"
        description={`Ranked by score. ${settings.scoreThreshold} and above is what reaches your board.`}
        actions={
          <span className="pb-1 text-xs text-ink-faint">
            {leads.length === PAGE_SIZE
              ? `${PAGE_SIZE}+ shown`
              : `${leads.length} ${leads.length === 1 ? "lead" : "leads"}`}
          </span>
        }
      />

      <FilterBar threshold={settings.scoreThreshold} />

      <LeadsTable
        leads={leads}
        threshold={settings.scoreThreshold}
        sort={sort}
        dir={dir}
      />

      {(page > 1 || leads.length === PAGE_SIZE) && (
        <Pagination page={page} full={leads.length === PAGE_SIZE} params={params} />
      )}
    </>
  );
}

function Pagination({
  page,
  full,
  params,
}: {
  page: number;
  full: boolean;
  params: Record<string, string | string[] | undefined>;
}) {
  const build = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      const single = first(value);
      if (single && key !== "page") next.set(key, single);
    }
    if (target > 1) next.set("page", String(target));
    return next.toString() ? `/leads?${next.toString()}` : "/leads";
  };

  return (
    <nav className="mt-8 flex items-center justify-between text-sm" aria-label="Pagination">
      {page > 1 ? (
        <a href={build(page - 1)} className="text-ink-muted hover:text-ink">
          ← Previous
        </a>
      ) : (
        <span />
      )}
      <span className="text-xs text-ink-faint">Page {page}</span>
      {full ? (
        <a href={build(page + 1)} className="text-ink-muted hover:text-ink">
          Next →
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Narrows an untrusted query parameter to a known value, or the fallback. */
function pick<T extends string>(
  value: string | string[] | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const single = first(value);
  return single && (allowed as readonly string[]).includes(single)
    ? (single as T)
    : fallback;
}

function numeric(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
