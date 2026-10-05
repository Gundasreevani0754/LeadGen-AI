import { GAP_LABELS } from "@/lib/score/score";
import type { LeadDetail } from "@/lib/leads/constants";

/**
 * The one-pager's own view of a lead.
 *
 * Built from the same `LeadDetail` the dashboard renders, so there is no second
 * source of truth to drift (§13). Nothing is computed here that the dashboard
 * does not also show — if a number on the PDF looks wrong, the same number is
 * wrong on screen, and there is one place to fix it.
 */

export interface OnePagerData {
  businessId: string;
  name: string;
  subtitle: string;
  score: number | null;
  qualified: boolean;

  facts: { label: string; value: string }[];
  gaps: string[];

  openingLine: string | null;
  painHypothesis: string | null;
  auditBlocks: AuditBlock[];

  contacts: { label: string; value: string }[];
  /** Where each fact came from, printed in the footer (guardrail §15.2). */
  sources: string[];
  generatedAt: Date;
}

export type AuditBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] };

export function toOnePagerData(lead: LeadDetail, threshold: number): OnePagerData {
  const qualified =
    lead.score !== null && lead.score >= threshold && !lead.components?.excluded;

  const facts = [
    { label: "Google rating", value: lead.rating === null ? "unrated" : `${lead.rating} / 5` },
    { label: "Reviews", value: String(lead.reviewCount ?? 0) },
    {
      label: "Years online",
      value: lead.domainAgeYears === null ? "unknown" : lead.domainAgeYears.toFixed(1),
    },
    {
      label: "Website",
      value: lead.techStack.length > 0 ? lead.techStack.slice(0, 2).join(", ") : "none found",
    },
  ];

  const sources = ["Google Maps listing"];
  if (lead.crawlStatus === "ok") sources.push("their own website");
  if (lead.domainAgeYears !== null) sources.push("domain registry (RDAP)");

  return {
    businessId: lead.id,
    name: lead.name,
    subtitle: [lead.category, lead.city].filter(Boolean).join(" · "),
    score: lead.score,
    qualified,
    facts,
    gaps: lead.gaps.map((gap) => GAP_LABELS[gap]),
    openingLine: lead.brief?.openingLine ?? null,
    painHypothesis: lead.brief?.painHypothesis ?? null,
    auditBlocks: lead.brief ? parseAudit(lead.brief.auditMarkdown) : [],
    contacts: contactLines(lead),
    sources,
    generatedAt: new Date(),
  };
}

function contactLines(lead: LeadDetail): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];

  if (lead.phoneE164) lines.push({ label: "Phone", value: lead.phoneE164 });
  if (lead.whatsappPhone && lead.whatsappPhone !== lead.phoneE164) {
    lines.push({ label: "WhatsApp", value: lead.whatsappPhone });
  }
  if (lead.email) lines.push({ label: "Email", value: lead.email });
  if (lead.websiteUrl) lines.push({ label: "Website", value: shorten(lead.websiteUrl) });
  if (lead.instagramUrl) lines.push({ label: "Instagram", value: shorten(lead.instagramUrl) });

  return lines;
}

/**
 * The same four constructs the dashboard's markdown renderer handles, flattened
 * for a PDF: paragraphs and bullets. Headings become paragraphs, bold is dropped
 * — react-pdf cannot switch weight mid-run without splitting the text node, and
 * an 80-word audit does not need it.
 */
export function parseAudit(markdown: string, maxBlocks = 6): AuditBlock[] {
  const blocks: AuditBlock[] = [];

  for (const raw of markdown.trim().split(/\n{2,}/)) {
    if (blocks.length >= maxBlocks) break;

    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0) continue;

    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      blocks.push({
        kind: "bullets",
        items: lines.map((line) => clean(line.replace(/^\s*[-*]\s+/, ""))),
      });
      continue;
    }

    blocks.push({ kind: "paragraph", text: clean(lines.join(" ")) });
  }

  return blocks;
}

function clean(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/** A filename that says what it is without shouting the prospect's name. */
export function onePagerFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `autotech-one-pager-${slug || "lead"}.pdf`;
}
