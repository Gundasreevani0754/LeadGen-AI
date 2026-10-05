/**
 * Unattended enrichment worker (Phase 3).
 *
 *   npm run enrich -- --limit 50
 *   npm run enrich -- --business <uuid> --retry-failed
 *   npm run enrich -- --force            # ignore the TTL and re-crawl
 *
 * Runs locally, sequentially and politely. Queue 500 leads and walk away — the
 * TTL means anything already enriched inside the window costs nothing.
 */
import { env } from "@/env";
import { runEnrichment } from "@/lib/enrich/worker";
import { getSettings } from "@/lib/settings";
import { runScoring } from "@/lib/score/persist";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const settings = await getSettings();
  const limit = Number(args.limit ?? 50);

  console.log(
    `enrich · limit ${limit} · ttl ${settings.enrichmentTtlDays}d` +
      (args["retry-failed"] ? " · retrying failed crawls" : "") +
      (args.force ? " · forcing re-crawl, ignoring TTL" : ""),
  );

  const summary = await runEnrichment({
    limit,
    ttlDays: settings.enrichmentTtlDays,
    includeFailed: Boolean(args["retry-failed"]),
    // --force ignores the TTL entirely. Only for a deliberate re-crawl, such as
    // after a change to what the crawler extracts.
    force: Boolean(args.force),
    businessId: typeof args.business === "string" ? args.business : undefined,
    enrichOptions: {
      gemini: args["no-gemini"]
        ? null
        : { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL },
    },
    onProgress: (target, result, index, total) => {
      const marks = [
        result.email && "email",
        result.whatsappPhone && "whatsapp",
        result.instagramUrl && "ig",
        result.facebookUrl && "fb",
        result.contactFormUrl && "form",
      ].filter(Boolean);

      console.log(
        `  [${index + 1}/${total}] ${result.crawlStatus.padEnd(7)} ${target.name}` +
          (marks.length ? `  → ${marks.join(", ")}` : "  → no contacts found"),
      );
    },
  });

  console.log(
    `\ndone · ${summary.ok} ok · ${summary.noSite} no site · ` +
      `${summary.blocked} blocked · ${summary.failed} failed · ` +
      `${summary.geminiCalls} Gemini calls`,
  );

  if (!args["no-score"] && summary.attempted > 0) {
    const scored = await runScoring({ threshold: settings.scoreThreshold, limit: 2000 });
    console.log(
      `scored ${scored.scored} · ${scored.qualified} at or above ${settings.scoreThreshold} · ` +
        `${scored.excluded} excluded · avg ${scored.averageTotal}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
