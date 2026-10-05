"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { releaseSuppression } from "@/lib/leads/mutations";
import { updateSettings } from "@/lib/settings";
import { CLAUDE_EFFORTS, MODEL_NAME } from "@/lib/settings-types";

/**
 * Settings are validated with the same bounds the environment schema uses.
 * A threshold of 400 or a ratio of 3 would not crash anything — it would just
 * quietly empty the board, which is worse.
 */
const schema = z.object({
  scoreThreshold: z.coerce.number().int().min(0).max(100),
  serviceProviderMaxRatio: z.coerce.number().min(0).max(1),
  enrichmentTtlDays: z.coerce.number().int().min(1).max(3650),
  // Charset-constrained, not just length-constrained: this value ends up on a
  // cmd.exe command line in the briefing worker. See assertSafeModel.
  claudeModel: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(MODEL_NAME, "Letters, digits, dot, dash and underscore only."),
  claudeEffort: z.enum(CLAUDE_EFFORTS as [string, ...string[]]),
  claudeDailyBriefCap: z.coerce.number().int().min(0).max(200),
  serpapiMonthlyQuota: z.coerce.number().int().min(0).max(1_000_000),
  apifyMonthlyCredits: z.coerce.number().min(0).max(10_000),
});

export type SettingsState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

export async function saveSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = schema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      status: "error",
      message: `${issue.path.join(".")}: ${issue.message}`,
    };
  }

  try {
    await updateSettings({
      ...parsed.data,
      claudeEffort: parsed.data.claudeEffort as (typeof CLAUDE_EFFORTS)[number],
    });

    // Thresholds change what every other surface shows.
    revalidatePath("/");
    revalidatePath("/leads");
    revalidatePath("/pipeline");
    revalidatePath("/settings");

    return { status: "ok", message: "Saved. Workers pick this up on their next run." };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Could not save settings.",
    };
  }
}

/**
 * Takes one entry off the do-not-source list.
 *
 * Kept deliberately unglamorous: the operator suppressed this on purpose, and
 * undoing it should be possible but never incidental.
 */
export async function releaseSuppressionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("suppressionId") ?? "");
  if (!id) return;

  await releaseSuppression(id);
  revalidatePath("/settings");
  revalidatePath("/leads");
}
