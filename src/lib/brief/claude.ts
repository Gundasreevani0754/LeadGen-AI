import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MODEL_NAME } from "@/lib/settings-types";

import { buildBatchPrompt, BRIEF_JSON_SCHEMA } from "./prompt";
import type { BriefBatchResult, BriefInput, BriefOutput } from "./types";

/**
 * Shells out to the local `claude` CLI on the operator's subscription.
 *
 * Two deliberate choices, both from §11:
 *
 * - The process runs in a fresh empty temp directory. A CLAUDE.md or a .claude
 *   folder in the repo would be loaded into every invocation, and that context
 *   is exactly the overhead batching exists to avoid.
 * - The prompt goes in over stdin, not as an argument. A fifteen-lead batch is
 *   comfortably past the command-line length limit on Windows.
 */

export interface ClaudeRunOptions {
  model: string;
  effort: string;
  /** Guards against a hung CLI holding the nightly run open forever. */
  timeoutMs?: number;
  /** Injected in tests so no real subscription quota is spent. */
  runner?: typeof runClaude;
}

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

export class ClaudeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeUnavailableError";
  }
}

interface RawResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** One `claude -p` invocation. Separated so the batch logic can be tested. */
export async function runClaude(
  prompt: string,
  args: string[],
  timeoutMs: number,
): Promise<RawResult> {
  const cwd = await mkdtemp(join(tmpdir(), "leadgen-brief-"));

  return new Promise<RawResult>((resolve, reject) => {
    /**
     * On Windows `claude` is a `.cmd` shim, which Node will not spawn without a
     * shell. Passing an args array *with* a shell concatenates them unquoted,
     * which shredded the `--json-schema` payload into invalid JSON. So on
     * Windows we quote the arguments ourselves and hand cmd one string.
     */
    const child =
      process.platform === "win32"
        ? spawn(`claude ${args.map(quoteForCmd).join(" ")}`, {
            cwd,
            shell: true,
            stdio: ["pipe", "pipe", "pipe"],
          })
        : spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new ClaudeUnavailableError(`claude timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(
        new ClaudeUnavailableError(
          `Could not start the claude CLI: ${error.message}. ` +
            `Install it and confirm a plain 'claude -p' call works on this machine.`,
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({ stdout, stderr, code });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Windows argument quoting: double the backslashes that precede a quote, escape
 * the quote, and wrap the whole thing. This is the same rule the C runtime uses
 * to parse argv, so what the CLI receives is exactly what we wrote.
 */
/**
 * Model names are pasted into a `cmd.exe` command line on Windows, and cmd.exe
 * parses `&`, `|`, `>` and friends *before* the C runtime ever sees the argv
 * quoting `quoteForCmd` applies — a literal `"` in the value re-opens the line
 * to the shell. The model is operator-settable from the Settings page, which is
 * unauthenticated by design, so it is the one argument here that does not
 * originate in this file. Constrain it to what a model name can actually be.
 */
export function assertSafeModel(model: string): string {
  if (!MODEL_NAME.test(model)) {
    throw new Error(
      `Refusing to run: "${model}" is not a valid model name (letters, digits, dot, dash, underscore).`,
    );
  }
  return model;
}

export function quoteForCmd(value: string): string {
  if (value === "") return '""';
  if (!/[\s"^&|<>()]/.test(value)) return value;

  const escaped = value
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1");

  return `"${escaped}"`;
}

/**
 * Briefs a whole batch in one session.
 *
 * `--json-schema` and `--effort` are passed when the installed CLI accepts them
 * and quietly dropped when it does not, because a CLI upgrade should not be able
 * to break the nightly run. The schema is belt and braces anyway: the result is
 * re-parsed and re-validated here regardless.
 */
export async function briefBatch(
  leads: BriefInput[],
  options: ClaudeRunOptions,
): Promise<BriefBatchResult> {
  const { model, effort, timeoutMs = DEFAULT_TIMEOUT_MS, runner = runClaude } = options;
  const prompt = buildBatchPrompt(leads);
  const warnings: string[] = [];

  let optionalFlags: string[][] = [
    ["--json-schema", JSON.stringify(BRIEF_JSON_SCHEMA)],
    ["--effort", effort],
  ];

  let attempt = await tryRun(prompt, model, optionalFlags, timeoutMs, runner);

  // Drop whichever optional flag the CLI rejected, one at a time, then retry.
  while (attempt.rejectedFlag) {
    const dropped = attempt.rejectedFlag;
    warnings.push(`This claude CLI does not accept ${dropped}; ran without it.`);
    optionalFlags = optionalFlags.filter((flag) => flag[0] !== dropped);
    attempt = await tryRun(prompt, model, optionalFlags, timeoutMs, runner);
  }

  if (attempt.error) throw new ClaudeUnavailableError(attempt.error);

  const parsed = parseEnvelope(attempt.result.stdout);
  const briefs = extractBriefs(parsed.text, leads, warnings);

  return {
    briefs,
    model,
    effort,
    sessionId: parsed.sessionId,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    warnings,
  };
}

async function tryRun(
  prompt: string,
  model: string,
  optionalFlags: string[][],
  timeoutMs: number,
  runner: typeof runClaude,
): Promise<{ result: RawResult; rejectedFlag: string | null; error: string | null }> {
  const args = [
    "-p",
    "--model",
    assertSafeModel(model),
    "--output-format",
    "json",
    ...optionalFlags.flat(),
  ];

  const result = await runner(prompt, args, timeoutMs);

  if (result.code !== 0) {
    const rejected = findRejectedFlag(result.stderr, optionalFlags);
    if (rejected) return { result, rejectedFlag: rejected, error: null };

    return {
      result,
      rejectedFlag: null,
      error: `claude exited ${result.code}: ${result.stderr.trim().slice(0, 500)}`,
    };
  }

  return { result, rejectedFlag: null, error: null };
}

function findRejectedFlag(stderr: string, optionalFlags: string[][]): string | null {
  const complaint = /unknown option|unrecognized option|unknown argument|invalid option/i;
  if (!complaint.test(stderr)) return null;

  for (const [flag] of optionalFlags) {
    if (stderr.includes(flag)) return flag;
  }
  return optionalFlags[0]?.[0] ?? null;
}

interface Envelope {
  text: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** `--output-format json` wraps the answer; older builds print it bare. */
export function parseEnvelope(stdout: string): Envelope {
  const fallback: Envelope = {
    text: stdout,
    sessionId: null,
    inputTokens: 0,
    outputTokens: 0,
  };

  const body = sliceJson(stdout);
  if (!body) return fallback;

  try {
    const parsed = JSON.parse(body) as {
      result?: unknown;
      session_id?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    if (typeof parsed.result !== "string") return fallback;

    return {
      text: parsed.result,
      sessionId: typeof parsed.session_id === "string" ? parsed.session_id : null,
      inputTokens: parsed.usage?.input_tokens ?? 0,
      outputTokens: parsed.usage?.output_tokens ?? 0,
    };
  } catch {
    return fallback;
  }
}

/**
 * Pulls the briefs out of whatever shape the model returned and drops anything
 * that does not correspond to a lead we asked about.
 */
export function extractBriefs(
  text: string,
  leads: BriefInput[],
  warnings: string[],
): BriefOutput[] {
  const body = sliceJson(text);
  if (!body) {
    warnings.push("No JSON found in the model output.");
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    warnings.push("Model output was not valid JSON.");
    return [];
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { briefs?: unknown }).briefs)
      ? (parsed as { briefs: unknown[] }).briefs
      : [];

  const byId = new Map(leads.map((lead) => [lead.businessId, lead]));
  const out: BriefOutput[] = [];

  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;

    const id = typeof record.id === "string" ? record.id : null;
    if (!id || !byId.has(id)) {
      warnings.push(`Ignored a brief for an unknown id: ${String(id)}`);
      continue;
    }

    const pain = asText(record.pain_hypothesis);
    const opening = asText(record.opening_line);
    const audit = asText(record.audit_markdown);
    if (!pain || !opening || !audit) {
      warnings.push(`Incomplete brief for ${byId.get(id)?.name ?? id}; skipped.`);
      continue;
    }

    out.push({
      businessId: id,
      painHypothesis: pain,
      openingLine: opening,
      auditMarkdown: audit,
    });
  }

  const missing = leads.filter(
    (lead) => !out.some((brief) => brief.businessId === lead.businessId),
  );
  for (const lead of missing) {
    warnings.push(`No brief returned for ${lead.name}.`);
  }

  return out;
}

/** Finds the outermost JSON value in a string that may carry prose or fences. */
export function sliceJson(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  const end = text.lastIndexOf(closer);
  if (end <= start) return null;

  return text.slice(start, end + 1);
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
