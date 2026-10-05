import { describe, expect, test } from "vitest";
import { zipSync, strToU8 } from "fflate";

import { readXlsxRows, rowsToRecords } from "./xlsx";

/** Builds the shape openpyxl's write-only mode produces: inline strings, one sheet. */
function workbook(rowsXml: string): Uint8Array {
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${rowsXml}</sheetData></worksheet>`;

  return zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
}

const row = (...cells: string[]) =>
  `<row>${cells
    .map((cell) => `<c t="inlineStr"><is><t>${cell}</t></is></c>`)
    .join("")}</row>`;

describe("readXlsxRows", () => {
  test("reads inline strings", () => {
    const rows = readXlsxRows(workbook(row("Company Name", "Contact Email")));
    expect(rows).toEqual([["Company Name", "Contact Email"]]);
  });

  test("reads numeric cells", () => {
    const xml = `<row><c t="n"><v>42</v></c></row>`;
    expect(readXlsxRows(workbook(xml))).toEqual([["42"]]);
  });

  test("keeps empty cells so columns stay aligned", () => {
    const xml = `<row><c t="inlineStr"><is><t>A</t></is></c><c/><c t="inlineStr"><is><t>C</t></is></c></row>`;
    expect(readXlsxRows(workbook(xml))).toEqual([["A", "", "C"]]);
  });

  test("decodes escaped entities", () => {
    const xml = `<row><c t="inlineStr"><is><t>Smith &amp; Sons &lt;x&gt;</t></is></c></row>`;
    expect(readXlsxRows(workbook(xml))).toEqual([["Smith & Sons <x>"]]);
  });

  test("a file with no sheet1 returns nothing rather than throwing", () => {
    const empty = zipSync({ "docProps/app.xml": strToU8("<x/>") });
    expect(readXlsxRows(empty)).toEqual([]);
  });
});

describe("rowsToRecords", () => {
  test("keys each row by the header row", () => {
    const rows = [
      ["Company Name", "Contact Email"],
      ["Innovatech", "priya@innovatech.example"],
    ];

    expect(rowsToRecords(rows)).toEqual([
      { "Company Name": "Innovatech", "Contact Email": "priya@innovatech.example" },
    ]);
  });

  test("skips blank rows", () => {
    const rows = [["Company Name"], [""], ["Real Co"]];
    expect(rowsToRecords(rows)).toEqual([{ "Company Name": "Real Co" }]);
  });

  test("tolerates a short row", () => {
    const rows = [["A", "B"], ["only-a"]];
    expect(rowsToRecords(rows)).toEqual([{ A: "only-a", B: "" }]);
  });

  test("a header-only sheet produces no records", () => {
    expect(rowsToRecords([["A", "B"]])).toEqual([]);
  });
});
