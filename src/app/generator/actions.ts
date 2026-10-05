"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { executeRun, previewRun, type RunPreview, type RunResult } from "@/lib/ingest";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const requestSchema = z.object({
  niche: z.string().trim().min(2, "Niche is too short").max(120),
  city: z.string().trim().min(2, "City is too short").max(120),
  limit: z.coerce.number().int().min(20).max(200),
  provider: z.enum(["serpapi", "apify"]),
});

export type PreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: RunPreview; request: z.infer<typeof requestSchema> };

export type RunState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; result: RunResult };

function parse(formData: FormData) {
  return requestSchema.safeParse({
    niche: formData.get("niche"),
    city: formData.get("city"),
    limit: formData.get("limit"),
    provider: formData.get("provider"),
  });
}

/** Free. Reads history only — spends no provider quota. */
export async function previewAction(
  _prev: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  try {
    return {
      status: "ready",
      preview: await previewRun(parsed.data),
      request: parsed.data,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Preview failed",
    };
  }
}

/** Spends provider quota. Only reachable after a preview has been shown. */
export async function runAction(
  _prev: RunState,
  formData: FormData,
): Promise<RunState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0].message };
  }

  // A double-clicked run button spends the search twice, and the provider bills
  // on request rather than on novelty.
  const limit = rateLimit({ key: "sourcing", ...LIMITS.sourcing });
  if (!limit.ok) {
    return {
      status: "error",
      message: `Slow down — try again in ${limit.retryAfter}s. Each run spends provider quota.`,
    };
  }

  try {
    const result = await executeRun(parsed.data);
    revalidatePath("/");
    revalidatePath("/history");
    return { status: "done", result };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Run failed",
    };
  }
}
