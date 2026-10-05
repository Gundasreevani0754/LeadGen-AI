import { pdfHeaders, renderOnePager } from "@/lib/pdf/render";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * One lead's one-pager, as a download.
 *
 * A GET so it can be an ordinary link on the lead detail page — no JavaScript,
 * no blob juggling, and the browser's own download UI does the work.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // The id goes into a `::uuid` cast downstream; rejecting it here means a
  // malformed request gets a 400 rather than a database error in the log.
  if (!UUID.test(id)) {
    return new Response("Not a lead id", { status: 400 });
  }

  // Rendering is the expensive part, so the limit is checked before it starts.
  const limit = rateLimit({ key: `one-pager:${id}`, ...LIMITS.onePager });
  if (!limit.ok) {
    return new Response("Too many one-pager requests; try again shortly", {
      status: 429,
      headers: { "retry-after": String(limit.retryAfter) },
    });
  }

  const rendered = await renderOnePager(id);
  if (!rendered) return new Response("No such lead", { status: 404 });

  return new Response(new Uint8Array(rendered.buffer), {
    headers: pdfHeaders(rendered.filename, rendered.buffer.byteLength),
  });
}
