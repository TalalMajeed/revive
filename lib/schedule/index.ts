import { importMspdi } from "./import-mspdi";
import { importXer, type XerImportOptions } from "./import-xer";
import type { ImportedSchedule } from "./types";

export * from "./types";
export * from "./calendar";
export * from "./cpm";
export { importXer, type XerImportOptions } from "./import-xer";
export { importMspdi, durationToDays } from "./import-mspdi";

/** Imports a P6 XER or MS Project XML file, telling them apart by content. */
export function importSchedule(text: string, options: XerImportOptions = {}): ImportedSchedule {
  const head = text.trimStart().slice(0, 512);
  if (head.startsWith("ERMHDR")) return importXer(text, options);
  if (head.startsWith("<?xml") || head.startsWith("<Project")) return importMspdi(text);
  throw new Error("Unrecognised schedule file: expected a P6 .xer or an MS Project .xml export");
}
