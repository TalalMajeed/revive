import { XMLParser } from "fast-xml-parser";
import type {
  ActivityStatus,
  Dependency,
  ImportedActivity,
  ImportedSchedule,
  LinkType,
} from "./types";

/**
 * MS Project XML (MSPDI) import: the format MS Project writes with
 * File > Save As > XML. Summary rows are skipped; links that touch them are
 * dropped with a warning.
 */

// MSPDI PredecessorLink/Type.
const LINK_TYPES: Record<string, LinkType> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

// LagFormat codes for elapsed units (calendar time rather than working time).
const ELAPSED_LAG_FORMATS = new Set(["4", "6", "8", "10", "12", "20"]);
const PERCENT_LAG_FORMATS = new Set(["19", "20"]);

type XmlNode = Record<string, unknown>;

export function importMspdi(xml: string): ImportedSchedule {
  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name) => name === "Task" || name === "PredecessorLink",
  });

  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch (err) {
    throw new Error(
      `Could not read the MS Project XML file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const project = doc.Project as XmlNode | undefined;
  if (!project) throw new Error("Not an MS Project XML file: no <Project> element");

  const minutesPerDay = Number(text(project.MinutesPerDay)) || 480;
  const tasks = ((project.Tasks as XmlNode | undefined)?.Task ?? []) as XmlNode[];
  const warnings: string[] = [];

  const activities: ImportedActivity[] = [];
  const byUid = new Map<string, ImportedActivity>();
  const durationOf = new Map<string, number>();
  const summaryUids = new Set<string>();

  for (const t of tasks) {
    const uid = text(t.UID);
    if (!uid) continue;
    // UID 0 is the project summary row; IsNull rows are blank lines.
    if (uid === "0" || flag(t.IsNull)) continue;
    if (flag(t.Summary)) {
      summaryUids.add(uid);
      continue;
    }
    if (text(t.Active) === "0") continue;

    const original = durationToDays(text(t.Duration), minutesPerDay);
    const pct = clampPct(Number(text(t.PercentComplete)) || 0);
    const actualStart = isoDate(text(t.ActualStart));
    const actualFinish = isoDate(text(t.ActualFinish));
    const status: ActivityStatus =
      pct >= 100 || actualFinish ? "complete" : actualStart || pct > 0 ? "in_progress" : "not_started";
    const isMilestone = flag(t.Milestone) || original === 0;

    const remainingText = text(t.RemainingDuration);
    let remaining =
      remainingText !== undefined
        ? durationToDays(remainingText, minutesPerDay)
        : round(original * (1 - pct / 100));
    if (status === "complete" || isMilestone) remaining = 0;

    const code = text(t.ID) ?? uid;
    const activity: ImportedActivity = {
      id: uid,
      code,
      name: text(t.Name) ?? `Task ${code}`,
      wbs: text(t.WBS) ?? text(t.OutlineNumber),
      isMilestone,
      status,
      duration: remaining,
      originalDuration: original,
      percentComplete: status === "complete" ? 100 : pct,
      plannedStart: isoDate(text(t.Start)),
      plannedFinish: isoDate(text(t.Finish)),
      actualStart,
      actualFinish,
    };
    activities.push(activity);
    byUid.set(uid, activity);
    durationOf.set(uid, original);
  }

  const dependencies: Dependency[] = [];
  let summaryLinks = 0;
  let approximateLags = 0;
  for (const t of tasks) {
    const succ = byUid.get(text(t.UID) ?? "");
    const links = (t.PredecessorLink ?? []) as XmlNode[];
    for (const link of links) {
      const predUid = text(link.PredecessorUID) ?? "";
      const pred = byUid.get(predUid);
      if (!succ || !pred) {
        if (summaryUids.has(predUid) || summaryUids.has(text(t.UID) ?? "")) summaryLinks++;
        continue;
      }
      const typeCode = text(link.Type) ?? "1";
      const lagFormat = text(link.LagFormat) ?? "7";
      // LinkLag is in tenths of a minute.
      const lagMinutes = (Number(text(link.LinkLag)) || 0) / 10;
      let lag: number;
      if (PERCENT_LAG_FORMATS.has(lagFormat)) {
        // Percent lags are a share of the predecessor's duration.
        lag = round(((Number(text(link.LinkLag)) || 0) / 1000) * (durationOf.get(predUid) ?? 0));
        approximateLags++;
      } else if (ELAPSED_LAG_FORMATS.has(lagFormat)) {
        // Elapsed time counted as calendar days, close enough for a forecast.
        lag = round(lagMinutes / 1440);
        approximateLags++;
      } else {
        lag = round(lagMinutes / minutesPerDay);
      }
      dependencies.push({
        predecessorId: pred.id,
        successorId: succ.id,
        type: LINK_TYPES[typeCode] ?? "FS",
        lag,
      });
    }
  }
  if (summaryUids.size) warnings.push(`Skipped ${summaryUids.size} summary tasks.`);
  if (summaryLinks) {
    warnings.push(
      `Dropped ${summaryLinks} links to or from summary tasks; link the activities underneath instead.`,
    );
  }
  if (approximateLags) {
    warnings.push(`${approximateLags} elapsed or percentage lags were converted approximately.`);
  }

  return {
    source: "mspdi",
    projectName: text(project.Title) ?? text(project.Name) ?? "Untitled project",
    plannedStart: isoDate(text(project.StartDate)),
    plannedFinish: isoDate(text(project.FinishDate)),
    dataDate: isoDate(text(project.StatusDate)),
    activities,
    dependencies,
    warnings,
  };
}

/**
 * ISO 8601 durations as MS Project writes them, e.g. "PT40H0M0S". A day
 * part, rare in practice, is read as working days.
 */
export function durationToDays(value: string | undefined, minutesPerDay = 480): number {
  if (!value) return 0;
  const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
    value.trim(),
  );
  if (!m) return 0;
  const [, d, h, min, s] = m.map((x) => Number(x) || 0);
  const minutes = h * 60 + min + s / 60;
  return round(d + minutes / minutesPerDay);
}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s === "" ? undefined : s;
}

function flag(value: unknown): boolean {
  const s = text(value);
  return s === "1" || s === "true";
}

/** "2026-01-05T08:00:00" -> "2026-01-05". */
function isoDate(value: string | undefined): string | undefined {
  const m = value && /^\d{4}-\d{2}-\d{2}/.exec(value);
  return m ? m[0] : undefined;
}

function clampPct(x: number): number {
  return Math.min(100, Math.max(0, x));
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
