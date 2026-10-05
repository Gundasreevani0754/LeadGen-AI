import { PageHeader } from "@/components/ui/page-header";
import { getFeedbackReport } from "@/lib/feedback/queries";
import { getBoard } from "@/lib/leads/queries";
import { getSettings } from "@/lib/settings";
import { Board } from "./board";
import { Signals } from "./signals";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [board, settings, report] = await Promise.all([
    getBoard(50),
    getSettings(),
    getFeedbackReport(),
  ]);

  const total = Object.values(board).reduce((sum, column) => sum + column.length, 0);

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Who you are talking to"
        description="Drag a card to move it, or use the select on the card. Marking a lead dead suppresses its phone and domain permanently."
        actions={
          <span className="pb-1 text-xs text-ink-faint">
            {total} {total === 1 ? "lead" : "leads"}
          </span>
        }
      />

      <Board board={board} threshold={settings.scoreThreshold} />

      <Signals report={report} />
    </>
  );
}
