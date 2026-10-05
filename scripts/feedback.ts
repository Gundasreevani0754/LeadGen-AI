/**
 * The feedback report in the terminal (Phase 8, spec §14).
 *
 *   npm run feedback
 *
 * Reads only. It joins what happened to leads against the score components they
 * were given, so the weights in `src/lib/score/score.ts` can eventually be set
 * from evidence rather than from the guesses the spec admits they are.
 */
import { getFeedbackReport } from "@/lib/feedback/queries";
import { MIN_SEGMENT_SAMPLE } from "@/lib/feedback/analysis";
import { SCORING_VERSION } from "@/lib/score/score";

async function main() {
  const report = await getFeedbackReport();

  console.log(`feedback · scoring v${SCORING_VERSION}`);
  console.log(
    `  ${report.worked} worked · ${report.replied} replied ` +
      `(${pct(report.replyRate)}) · ${report.booked} booked · ${report.won} won · ` +
      `${report.dead} dead`,
  );

  if (report.worked === 0) {
    console.log(
      "\nNothing contacted yet. Move leads to Contacted and record what came back;\n" +
        "this report reads the pipeline event log, not the current status alone.",
    );
    return;
  }

  console.log(
    report.readyToRetune
      ? `\nEnough data to re-tune. Change the weights in src/lib/score/score.ts and\n` +
          `bump SCORING_VERSION so the old numbers stay interpretable.`
      : `\n${report.untilRetune} more worked leads before a re-tune is justified.`,
  );

  for (const dimension of report.dimensions) {
    if (dimension.segments.length < 2) continue;

    console.log(`\n${dimension.title}`);
    console.log(`  ${dimension.question}`);

    for (const segment of dimension.segments) {
      const mark = segment.reliable ? " " : "?";
      console.log(
        `  ${mark} ${segment.label.padEnd(34)} ` +
          `${String(segment.worked).padStart(4)} worked  ` +
          `${String(segment.replied).padStart(4)} replied  ` +
          `${pct(segment.replyRate).padStart(5)}  ` +
          `${segment.lift.toFixed(2)}x`,
      );
    }
  }

  console.log(
    `\n? marks a segment under ${MIN_SEGMENT_SAMPLE} leads — noise, not signal.`,
  );
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
