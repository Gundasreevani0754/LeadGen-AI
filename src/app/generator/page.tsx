import { PageHeader } from "@/components/ui/page-header";
import { GeneratorForm } from "./generator-form";

export const dynamic = "force-dynamic";

/**
 * Replaying a run from History arrives here with the query prefilled, so the
 * operator lands on the free check rather than retyping a niche they have
 * already sourced once.
 */
export default async function GeneratorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        eyebrow="Generator"
        title="Source a niche"
        description="Check what a query will cost against what you already have, then run it."
      />
      <GeneratorForm
        initialNiche={first(params.niche) ?? ""}
        initialCity={first(params.city) ?? ""}
        initialProvider={first(params.provider) === "apify" ? "apify" : "serpapi"}
      />
    </>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
