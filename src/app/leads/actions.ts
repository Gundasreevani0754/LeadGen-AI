"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runBriefing } from "@/lib/brief/worker";
import { runEnrichment } from "@/lib/enrich/worker";
import {
  setNextAction,
  setNote,
  setStatus,
  suppress,
  unsuppress,
} from "@/lib/leads/mutations";
import { PIPELINE_STATUSES } from "@/lib/leads/queries";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { runScoring } from "@/lib/score/persist";
import { getSettings } from "@/lib/settings";

/**
 * Every mutation the dashboard exposes.
 *
 * Each one revalidates the surfaces that show the value it changed, because the
 * whole app is `force-dynamic` for correctness and stale reads here would mean
 * the operator acting on a number that is no longer true.
 */

const statusSchema = z.enum(
  PIPELINE_STATUSES as [(typeof PIPELINE_STATUSES)[number], ...typeof PIPELINE_STATUSES],
);

export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message: string }
  | { status: "error"; message: string };

function refresh(id?: string) {
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath("/pipeline");
  if (id) revalidatePath(`/leads/${id}`);
}

export async function bulkStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ids = formData.getAll("selected").map(String).filter(Boolean);
  const parsed = statusSchema.safeParse(formData.get("status"));

  if (!parsed.success) return { status: "error", message: "Unknown status." };
  if (ids.length === 0) return { status: "error", message: "Nothing selected." };

  try {
    await setStatus(ids, parsed.data);
    refresh();
    return {
      status: "ok",
      message: `Moved ${ids.length} ${ids.length === 1 ? "lead" : "leads"} to ${parsed.data.replace("_", " ")}.`,
    };
  } catch (error) {
    return { status: "error", message: describe(error) };
  }
}

export async function bulkSuppressAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ids = formData.getAll("selected").map(String).filter(Boolean);
  if (ids.length === 0) return { status: "error", message: "Nothing selected." };

  try {
    const n = await suppress(ids, "do_not_contact");
    await setStatus(ids, "dead");
    refresh();
    return {
      status: "ok",
      message: `Suppressed ${n}. They will never appear in a future search.`,
    };
  } catch (error) {
    return { status: "error", message: describe(error) };
  }
}

/** Moves one lead on the Kanban board. */
export async function moveStatusAction(formData: FormData): Promise<void> {
  const id = String(formData.get("businessId") ?? "");
  const parsed = statusSchema.safeParse(formData.get("status"));
  if (!id || !parsed.success) return;

  await setStatus([id], parsed.data);
  refresh(id);
}

export async function saveNoteAction(formData: FormData): Promise<void> {
  const id = String(formData.get("businessId") ?? "");
  const note = String(formData.get("note") ?? "");
  if (!id) return;

  await setNote(id, note);
  refresh(id);
}

export async function saveNextActionAction(formData: FormData): Promise<void> {
  const id = String(formData.get("businessId") ?? "");
  const raw = String(formData.get("nextActionAt") ?? "").trim();
  if (!id) return;

  const date = raw ? new Date(raw) : null;
  await setNextAction(id, date && !Number.isNaN(date.getTime()) ? date : null);
  refresh(id);
}

export async function suppressLeadAction(formData: FormData): Promise<void> {
  const id = String(formData.get("businessId") ?? "");
  if (!id) return;

  if (formData.get("undo")) await unsuppress(id);
  else await suppress([id], "do_not_contact");

  refresh(id);
}

/**
 * Generates a brief for one lead, on demand.
 *
 * `regenerate` is the only path that may spend quota on a lead that already has
 * a brief, and it increments `regenerated_count` so the ledger stays honest.
 */
export async function briefLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("businessId") ?? "");
  const regenerate = Boolean(formData.get("regenerate"));
  if (!id) return { status: "error", message: "No lead given." };

  const limit = rateLimit({ key: "brief:single", ...LIMITS.brief });
  if (!limit.ok) {
    return {
      status: "error",
      message: `Slow down — try again in ${limit.retryAfter}s. Briefs cost plan quota.`,
    };
  }

  try {
    const summary = await runBriefing({ businessId: id, limit: 1, regenerate });
    refresh(id);

    if (summary.written > 0) {
      return {
        status: "ok",
        message: regenerate ? "Brief regenerated." : "Brief written.",
      };
    }

    return {
      status: "error",
      message: summary.warnings[0] ?? "Claude returned nothing usable.",
    };
  } catch (error) {
    return { status: "error", message: describe(error) };
  }
}

/** Re-crawls one lead now, ignoring the TTL, then re-scores it. */
export async function recrawlLeadAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const id = String(formData.get("businessId") ?? "");
  if (!id) return { status: "error", message: "No lead given." };

  const limit = rateLimit({ key: "recrawl", ...LIMITS.recrawl });
  if (!limit.ok) {
    return {
      status: "error",
      message: `Slow down — try again in ${limit.retryAfter}s. Crawling stays polite.`,
    };
  }

  try {
    const settings = await getSettings();
    const summary = await runEnrichment({
      businessId: id,
      limit: 1,
      force: true,
      includeFailed: true,
    });

    if (summary.attempted === 0) {
      return { status: "error", message: "Nothing to crawl for this lead." };
    }

    await runScoring({ businessId: id, threshold: settings.scoreThreshold, limit: 1 });
    refresh(id);
    return { status: "ok", message: "Re-crawled and re-scored." };
  } catch (error) {
    return { status: "error", message: describe(error) };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
