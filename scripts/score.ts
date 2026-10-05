/**
 * Re-scores the database (Phase 4).
 *
 *   npm run score
 *   npm run score -- --only-unscored
 *
 * Pure computation over facts already stored — it makes no network calls and
 * spends no quota, so it is always safe to run.
 */
import { runScoring } from "@/lib/score/persist";
import { SCORING_VERSION } from "@/lib/score/score";
import { getSettings } from "@/lib/settings";

async function main() {
  const args = new Set(process.argv.slice(2));
  const settings = await getSettings();

  const summary = await runScoring({
    threshold: settings.scoreThreshold,
    limit: 5000,
    onlyUnscored: args.has("--only-unscored"),
  });

  console.log(`scoring v${SCORING_VERSION} · threshold ${settings.scoreThreshold}`);
  console.log(`  scored          ${summary.scored}`);
  console.log(`  qualified       ${summary.qualified}`);
  console.log(`  excluded        ${summary.excluded}`);
  console.log(`  businesses      ${summary.businesses}`);
  console.log(`  providers       ${summary.serviceProviders}`);
  console.log(`  average total   ${summary.averageTotal}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
