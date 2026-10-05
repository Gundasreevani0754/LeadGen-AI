import { unzipSync, strFromU8 } from "fflate";

/**
 * A minimal reader for the Excel files the Flask app produced.
 *
 * It is not a general XLSX parser and does not pretend to be. openpyxl in
 * write-only mode emits inline strings and nothing else — no shared string
 * table, no styles worth reading, one sheet — so a full spreadsheet library
 * would be several megabytes of dependency to parse three files once.
 *
 * If it ever meets a file it does not understand, it returns what it could read
 * rather than guessing, and the importer reports the row count so a silent
 * half-import is visible.
 */

// `[\s\S]` rather than the `s` (dotAll) flag: the project targets ES2017,
// where that flag is not available.
// The self-closing form has to be tried first. Otherwise `<c/>` falls through
// to the open-tag alternative, which then runs greedily to the *next* cell's
// `</c>` and swallows it — silently shifting every column after a blank cell.
const CELL = /<c\b[^>]*\/>|<c\b[^>]*>([\s\S]*?)<\/c>/g;
const ROW = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
const INLINE = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/;
const VALUE = /<v>([\s\S]*?)<\/v>/;

export function readXlsxRows(file: Uint8Array): string[][] {
  const unzipped = unzipSync(file);

  const sheetPath = Object.keys(unzipped).find((name) =>
    /^xl\/worksheets\/sheet1\.xml$/i.test(name),
  );
  if (!sheetPath) return [];

  const xml = strFromU8(unzipped[sheetPath]);
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(ROW)) {
    const cells: string[] = [];

    for (const cellMatch of rowMatch[1].matchAll(CELL)) {
      const body = cellMatch[1] ?? "";
      const inline = body.match(INLINE);
      const value = body.match(VALUE);
      cells.push(decode(inline?.[1] ?? value?.[1] ?? ""));
    }

    rows.push(cells);
  }

  return rows;
}

/** Turns a sheet with a header row into objects keyed by that header. */
export function rowsToRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length < 2) return [];

  const header = rows[0].map((cell) => cell.trim());
  const records: Record<string, string>[] = [];

  for (const row of rows.slice(1)) {
    if (row.every((cell) => cell.trim() === "")) continue;

    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      if (key) record[key] = (row[index] ?? "").trim();
    });
    records.push(record);
  }

  return records;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}
