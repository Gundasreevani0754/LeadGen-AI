import { pdfHeaders, renderOnePagerBundle } from "@/lib/pdf/render";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

/**
 * Bulk download: every selected lead, one page each, in a single file.
 *
 * A plain form POST from the leads table, which is why this is a route handler
 * rather than a server action — an action can revalidate and redirect, but it
 * cannot hand the browser a file.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Enough for a full page of the leads table, and a ceiling on render time. */
const MAX_LEADS = 100;

export async function POST(request: Request) {
  const form = await request.formData();

  const ids = [...new Set(form.getAll("selected").map(String))]
    .filter((id) => UUID.test(id))
    .slice(0, MAX_LEADS);

  if (ids.length === 0) {
    return new Response("Select at least one lead first", { status: 400 });
  }

  const limit = rateLimit({ key: "one-pagers:bundle", ...LIMITS.onePagerBundle });
  if (!limit.ok) {
    return new Response("Too many bulk exports; try again shortly", {
      status: 429,
      headers: { "retry-after": String(limit.retryAfter) },
    });
  }

  const rendered = await renderOnePagerBundle(ids);
  if (!rendered) return new Response("None of those leads exist", { status: 404 });

  return new Response(new Uint8Array(rendered.buffer), {
    headers: pdfHeaders(rendered.filename, rendered.buffer.byteLength),
  });
}
