/**
 * Imports the Flask app's data into the quarantined `legacy_*` tables (Phase 9).
 *
 *   npm run migrate:legacy
 *   npm run migrate:legacy -- --dry-run
 *
 * Reads `legacy/instance/leadforge.db` and every `leadgen_*.xlsx` in
 * `legacy/exports/`, falling back to the pre-archive root locations.
 * Idempotent: a unique index on (source, company name, email) means running it
 * twice imports nothing the second time.
 *
 * These rows never enter `businesses`. The old app invented its leads and
 * constructed their email addresses, so treating them as facts would break the
 * first guardrail in the spec and would seed dedupe with companies that do not
 * exist. Nothing is lost; nothing is trusted.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { legacyLeads, legacySearches } from "@/db/schema";
import { readXlsxRows, rowsToRecords } from "@/lib/legacy/xlsx";

/**
 * The Flask app now lives in `legacy/`, but the importer still looks in the old
 * root locations so it keeps working against an un-archived checkout.
 */
const SQLITE_PATHS = ["legacy/instance/leadforge.db", "instance/leadforge.db"];
const EXPORT_DIRS = ["legacy/exports", "."];

function sqlitePath(): string | null {
  return SQLITE_PATHS.find((path) => existsSync(path)) ?? null;
}
const dryRun = process.argv.includes("--dry-run");

interface LeadInput {
  source: string;
  searchId: string | null;
  companyName: string;
  contactPerson: string | null;
  designation: string | null;
  contactEmail: string | null;
  contactLinkedinUrl: string | null;
  companyLinkedinUrl: string | null;
  companyLocation: string | null;
  companySize: string | null;
}

async function main() {
  console.log(dryRun ? "migrate:legacy (dry run)\n" : "migrate:legacy\n");

  const searchIds = await importSqliteSearches();
  const fromDb = readSqliteLeads(searchIds);
  const fromExcel = readExcelLeads();

  const all = [...fromDb, ...fromExcel];
  console.log(
    `  ${fromDb.length} leads from SQLite, ${fromExcel.length} from Excel files not already in it`,
  );

  if (dryRun) {
    console.log("\nDry run — nothing written.");
    return;
  }

  const written = await writeLeads(all);
  console.log(`\n  ${written} new legacy leads stored (duplicates skipped)`);

  const counts = await db
    .select()
    .from(legacyLeads)
    .then((rows) => rows.length);
  console.log(`  legacy_leads now holds ${counts} rows`);
  console.log(
    "\nThese are quarantined: unverified, model-generated, and joined to nothing\n" +
      "in the pipeline. They exist so the old work is not lost.",
  );
}

/** The Flask `search` table becomes `legacy_searches`, keyed by its old id. */
async function importSqliteSearches(): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const path = sqlitePath();
  if (!path) {
    console.log("  no leadforge.db found — skipping the Flask database");
    return map;
  }

  const sqlite = new DatabaseSync(path, { readOnly: true });
  const rows = sqlite
    .prepare(
      `select id, offering, target_client, region, lead_count, created_at from search`,
    )
    .all() as Record<string, string | number | null>[];
  sqlite.close();

  // Match on the id the row had in SQLite, so a re-run reuses the same search
  // rather than creating a second copy of it.
  const known = await db
    .select({ id: legacySearches.id, sourceId: legacySearches.sourceId })
    .from(legacySearches)
    .where(eq(legacySearches.source, "flask-sqlite"));

  const bySourceId = new Map(known.map((row) => [row.sourceId, row.id]));

  for (const row of rows) {
    const sourceId = String(row.id);
    const existing = bySourceId.get(sourceId);

    if (existing) {
      map.set(Number(row.id), existing);
      continue;
    }

    if (dryRun) {
      map.set(Number(row.id), "dry-run");
      continue;
    }

    const [inserted] = await db
      .insert(legacySearches)
      .values({
        sourceId,
        source: "flask-sqlite",
        offering: asText(row.offering),
        targetClient: asText(row.target_client),
        region: asText(row.region),
        leadCount: row.lead_count === null ? null : Number(row.lead_count),
        searchedAt: row.created_at ? new Date(String(row.created_at)) : null,
      })
      .returning({ id: legacySearches.id });

    map.set(Number(row.id), inserted.id);
  }

  console.log(`  ${rows.length} searches from the Flask database`);
  return map;
}

function readSqliteLeads(searchIds: Map<number, string>): LeadInput[] {
  const path = sqlitePath();
  if (!path) return [];

  const sqlite = new DatabaseSync(path, { readOnly: true });
  const rows = sqlite.prepare(`select * from lead`).all() as Record<
    string,
    string | number | null
  >[];
  sqlite.close();

  return rows.map((row) => ({
    source: "flask-sqlite",
    searchId: searchIds.get(Number(row.search_id)) || null,
    companyName: String(row.company_name ?? "").trim(),
    contactPerson: asText(row.contact_person),
    designation: asText(row.designation),
    contactEmail: asText(row.contact_email),
    contactLinkedinUrl: asText(row.contact_linkedin_url),
    companyLinkedinUrl: asText(row.company_linkedin_url),
    companyLocation: asText(row.company_location),
    companySize: asText(row.company_size),
  }));
}

/**
 * The Excel exports overlap the database almost entirely — except the earliest
 * file, whose rows exist nowhere else. Every file is read anyway; the unique
 * index decides what is actually new.
 */
function readExcelLeads(): LeadInput[] {
  const dir = EXPORT_DIRS.find((candidate) => existsSync(candidate)) ?? ".";
  const files = readdirSync(dir).filter(
    (name) => name.startsWith("leadgen_") && name.endsWith(".xlsx"),
  );

  const leads: LeadInput[] = [];

  for (const file of files) {
    const records = rowsToRecords(readXlsxRows(readFileSync(`${dir}/${file}`)));
    console.log(`  ${records.length} rows from ${file}`);

    for (const record of records) {
      const companyName = pick(record, ["Company Name", "company_name"]);
      if (!companyName) continue;

      leads.push({
        source: `excel:${file}`,
        searchId: null,
        companyName,
        contactPerson: pick(record, ["Contact Person"]),
        designation: pick(record, ["Designation"]),
        contactEmail: pick(record, ["Contact Email"]),
        contactLinkedinUrl: pick(record, ["Contact LinkedIn URL", "Contact LinkedIn"]),
        companyLinkedinUrl: pick(record, ["Company LinkedIn URL", "Company LinkedIn"]),
        companyLocation: pick(record, ["Company Location"]),
        companySize: pick(record, ["Company Size"]),
      });
    }
  }

  return leads;
}

async function writeLeads(leads: LeadInput[]): Promise<number> {
  const valid = leads.filter((lead) => lead.companyName.length > 0);
  if (valid.length === 0) return 0;

  let written = 0;
  // One at a time so a single conflicting row does not drop the whole batch.
  for (const lead of valid) {
    const inserted = await db
      .insert(legacyLeads)
      .values(lead)
      .onConflictDoNothing()
      .returning({ id: legacyLeads.id });
    if (inserted.length > 0) written += 1;
  }

  return written;
}

function asText(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function pick(record: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (value && value.trim()) return value.trim();
  }
  return null;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
