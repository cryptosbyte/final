import AdmZip from "adm-zip";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";

// sql.js loads its wasm with `fetch(file)` relative to the script's URL,
// which esbuild rewrites to the bundled output. We expect the consuming app
// to ship `sql-wasm.wasm` next to the bundle (see api-server/build.mjs).
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export interface ParsedCard {
  type: "basic" | "cloze";
  front: string;
  back: string;
  tags: string;
}

function stripAnkiHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

/**
 * Parse an Anki .apkg (a zip containing a SQLite collection database). The
 * notes table's `flds` column is `\x1f`-separated; we take the first two
 * fields as front and back. A note with `{{c\d::...}}` markers in its first
 * field is treated as a cloze card.
 */
export async function parseApkg(buffer: Buffer): Promise<ParsedCard[]> {
  const zip = new AdmZip(buffer);
  const entry =
    zip.getEntry("collection.anki21") || zip.getEntry("collection.anki2");
  if (!entry) {
    throw new Error("Not a valid .apkg (missing collection database)");
  }
  const dbBuf = entry.getData();
  const SQL = await initSqlJs({
    locateFile: (file: string) => `${SCRIPT_DIR}/${file}`,
  });
  const sqliteDb = new SQL.Database(new Uint8Array(dbBuf));
  const result = sqliteDb.exec("SELECT flds, tags FROM notes");
  const cards: ParsedCard[] = [];
  if (result[0]) {
    for (const row of result[0].values) {
      const flds = String(row[0] ?? "");
      const tags = String(row[1] ?? "").trim();
      const fields = flds.split("\x1f");
      const front = (fields[0] ?? "").trim();
      const back = (fields[1] ?? "").trim();
      if (!front) continue;
      const isCloze = /\{\{c\d+::/.test(front);
      cards.push({
        type: isCloze ? "cloze" : "basic",
        front: stripAnkiHtml(front),
        back: stripAnkiHtml(back),
        tags,
      });
    }
  }
  sqliteDb.close();
  return cards;
}
