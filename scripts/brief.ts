/**
 * Claude briefing worker (Phase 6).
 *
 *   npm run brief                    # today's batch, capped
 *   npm run brief -- --dry-run       # show the batch, start no session
 *   npm run brief -- --limit 5
 *   npm run brief -- --business <uuid> --regenerate
 *
 * Runs locally on the subscription. One session per batch, by design: a single
 * `claude -p` invocation loads tens of thousands of tokens of context before it
 * reads the prompt, and paying that once is the whole point of batching.
 */
import { getBriefQuota, runBriefing } from "@/lib/brief/worker";
import { getSettings } from "@/lib/settings";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const settings = await getSettings();
  const quota = await getBriefQuota();

  console.log(
    `brief · model ${settings.claudeModel} · effort ${settings.claudeEffort} · ` +
      `${quota.usedToday}/${quota.cap} used today`,
  );

  const summary = await runBriefing({
    limit: args.limit ? Number(args.limit) : undefined,
    businessId: typeof args.business === "string" ? args.business : undefined,
    regenerate: Boolean(args.regenerate),
    dryRun: Boolean(args["dry-run"]),
    onBatch: (leads) => {
      console.log(`\nbatch of ${leads.length}:`);
      for (const lead of leads) {
        console.log(
          `  ${String(lead.score).padStart(3)}  ${lead.name}` +
            (lead.city ? ` · ${lead.city}` : ""),
        );
      }
      console.log("");
    },
  });

  for (const warning of summary.warnings) console.log(`  ! ${warning}`);

  console.log(
    `\ndone · ${summary.written} written · ${summary.heldByRatio} held by the 70/30 cap · ` +
      `${summary.inputTokens} in / ${summary.outputTokens} out tokens`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
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
