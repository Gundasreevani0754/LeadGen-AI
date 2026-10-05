import "server-only";
import { Document, renderToBuffer } from "@react-pdf/renderer";

import { getLeadDetail } from "@/lib/leads/queries";
import { getSettings } from "@/lib/settings";
import { BRAND } from "./brand";
import { onePagerFilename, toOnePagerData, type OnePagerData } from "./data";
import { OnePager } from "./one-pager";

/**
 * Turns leads into PDF bytes.
 *
 * The `Document` wrapper is built here rather than exported from `one-pager.tsx`
 * because `renderToBuffer` insists on being handed a `Document` element itself —
 * a component that merely returns one does not satisfy it.
 *
 * `renderToBuffer` rather than the stream API: a one-pager is a few kilobytes,
 * the route sets Content-Length anyway, and buffering means a render failure
 * becomes a clean 500 instead of a truncated file.
 */

export interface RenderedPdf {
  buffer: Buffer;
  filename: string;
}

function bundle(leads: OnePagerData[], title: string) {
  return (
    <Document title={title} author={BRAND.operator} creator={BRAND.name}>
      {leads.map((lead) => (
        <OnePager key={lead.businessId} data={lead} />
      ))}
    </Document>
  );
}

export async function renderOnePager(businessId: string): Promise<RenderedPdf | null> {
  const [lead, settings] = await Promise.all([getLeadDetail(businessId), getSettings()]);
  if (!lead) return null;

  const data = toOnePagerData(lead, settings.scoreThreshold);
  const buffer = await renderToBuffer(bundle([data], "Autotech one-pager"));

  return { buffer, filename: onePagerFilename(lead.name) };
}

/**
 * Several leads in one file, one page each.
 *
 * An id that no longer resolves is skipped rather than failing the batch — a
 * bulk download of fifty should not die because one lead was suppressed while
 * the table was open.
 */
export async function renderOnePagerBundle(
  businessIds: string[],
): Promise<RenderedPdf | null> {
  const settings = await getSettings();

  const leads: OnePagerData[] = [];
  for (const id of businessIds) {
    const lead = await getLeadDetail(id);
    if (lead) leads.push(toOnePagerData(lead, settings.scoreThreshold));
  }

  if (leads.length === 0) return null;
  if (leads.length === 1) {
    return {
      buffer: await renderToBuffer(bundle(leads, "Autotech one-pager")),
      filename: onePagerFilename(leads[0].name),
    };
  }

  const buffer = await renderToBuffer(
    bundle(leads, `Autotech one-pagers (${leads.length})`),
  );
  const stamp = new Date().toISOString().slice(0, 10);

  return { buffer, filename: `autotech-one-pagers-${leads.length}-${stamp}.pdf` };
}

/** The headers that make a browser download rather than display the file. */
export function pdfHeaders(filename: string, size: number): HeadersInit {
  return {
    "content-type": "application/pdf",
    "content-length": String(size),
    "content-disposition": `attachment; filename="${filename}"`,
    // These are live records; a cached copy would show yesterday's score.
    "cache-control": "no-store",
  };
}
