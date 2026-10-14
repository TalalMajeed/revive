import { XER } from "xer-parser";
import type {
  ActivityStatus,
  Dependency,
  ImportedActivity,
  ImportedSchedule,
  LinkType,
} from "./types";

/**
 * Primavera P6 XER import.
 *
 * xer-parser does the parsing. Hours and dates are read from its raw tables
 * rather than its entity helpers: the helpers return 0 for a duration whose
 * calendar is missing, and parse dates in the server's time zone.
 */

export interface XerImportOptions {
  /** P6 proj_id or proj_short_name. Defaults to the first project with tasks. */
  project?: number | string;
}

const PRED_TYPES: Record<string, LinkType> = {
  PR_FS: "FS",
  PR_SS: "SS",
  PR_FF: "FF",
  PR_SF: "SF",
};

const STATUS: Record<string, ActivityStatus> = {
  TK_NotStart: "not_started",
  TK_Active: "in_progress",
  TK_Complete: "complete",
};

type Row = Record<string, string>;

export function importXer(text: string, options: XerImportOptions = {}): ImportedSchedule {
  let xer: XER;
  try {
    xer = new XER(text);
  } catch (err) {
    throw new Error(
      `Could not read the XER file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const table = (name: string): Row[] => {
    const t = xer.tables.find((x) => x.name === name);
    if (!t) return [];
    return t.rows.map((r) => Object.fromEntries(t.header.map((h, i) => [h, r[i] ?? ""])));
  };

  const projects = table("PROJECT");
  const tasks = table("TASK");
  if (projects.length === 0) throw new Error("The XER file has no projects");

  const project = pickProject(projects, tasks, options.project);
  const projId = project.proj_id;
  const warnings: string[] = [];

  // Hours per day for each calendar; P6 stores every duration in hours.
  const hoursPerDay = new Map<string, number>();
  for (const c of table("CALENDAR")) {
    const h = Number(c.day_hr_cnt);
    hoursPerDay.set(c.clndr_id, h > 0 ? h : 8);
  }
  const days = (hours: string, clndrId: string): number => {
    const h = Number(hours) || 0;
    const perDay = hoursPerDay.get(clndrId) ?? 8;
    return round(h / perDay);
  };

  const wbsPath = buildWbsPaths(table("PROJWBS").filter((w) => w.proj_id === projId));

  const activities: ImportedActivity[] = [];
  const included = new Map<string, ImportedActivity>(); // task_id -> activity
  let skippedLoe = 0;
  let skippedWbs = 0;

  for (const t of tasks) {
    if (t.proj_id !== projId) continue;
    if (t.task_type === "TT_LOE") {
      skippedLoe++;
      continue;
    }
    if (t.task_type === "TT_WBS") {
      skippedWbs++;
      continue;
    }

    if (included.has(t.task_id)) continue;
    const status = STATUS[t.status_code] ?? "not_started";
    const isMilestone = t.task_type === "TT_Mile" || t.task_type === "TT_FinMile";
    const remaining = status === "complete" || isMilestone ? 0 : days(t.remain_drtn_hr_cnt, t.clndr_id);
    const activity: ImportedActivity = {
      id: t.task_code || t.task_id,
      code: t.task_code || t.task_id,
      name: t.task_name,
      wbs: wbsPath.get(t.wbs_id),
      isMilestone,
      status,
      duration: remaining,
      originalDuration: isMilestone ? 0 : days(t.target_drtn_hr_cnt, t.clndr_id),
      percentComplete: clampPct(Number(t.phys_complete_pct) || (status === "complete" ? 100 : 0)),
      plannedStart: isoDate(t.target_start_date),
      plannedFinish: isoDate(t.target_end_date),
      actualStart: isoDate(t.act_start_date),
      actualFinish: isoDate(t.act_end_date),
    };
    if (activities.some((a) => a.id === activity.id)) {
      warnings.push(`Activity ID ${activity.id} appears twice; using task_id ${t.task_id} for the second one.`);
      activity.id = `${activity.id}#${t.task_id}`;
    }
    included.set(t.task_id, activity);
    activities.push(activity);
  }

  if (skippedLoe) warnings.push(`Skipped ${skippedLoe} level-of-effort activities; they don't drive the finish date.`);
  if (skippedWbs) warnings.push(`Skipped ${skippedWbs} WBS summary activities.`);

  const calendarOfTask = new Map(tasks.map((t) => [t.task_id, t.clndr_id]));
  const dependencies: Dependency[] = [];
  let droppedLinks = 0;
  for (const p of table("TASKPRED")) {
    const succ = included.get(p.task_id);
    const pred = included.get(p.pred_task_id);
    if (!succ && !pred) continue; // another project's link
    if (!succ || !pred) {
      droppedLinks++;
      continue;
    }
    const type = PRED_TYPES[p.pred_type];
    if (!type) {
      warnings.push(`Unknown link type ${p.pred_type} between ${pred.code} and ${succ.code}; treated as FS.`);
    }
    // P6 converts lag hours on the successor's calendar by default.
    dependencies.push({
      predecessorId: pred.id,
      successorId: succ.id,
      type: type ?? "FS",
      lag: days(p.lag_hr_cnt, calendarOfTask.get(p.task_id) ?? project.clndr_id),
    });
  }
  if (droppedLinks) {
    warnings.push(`Dropped ${droppedLinks} links to skipped activities or other projects.`);
  }

  return {
    source: "xer",
    projectName: project.proj_short_name || `Project ${projId}`,
    plannedStart: isoDate(project.plan_start_date),
    plannedFinish: isoDate(project.plan_end_date) ?? isoDate(project.scd_end_date),
    dataDate: isoDate(project.last_recalc_date),
    activities,
    dependencies,
    warnings,
  };
}

function pickProject(projects: Row[], tasks: Row[], wanted?: number | string): Row {
  if (wanted !== undefined) {
    const key = String(wanted);
    const found = projects.find((p) => p.proj_id === key || p.proj_short_name === key);
    if (!found) throw new Error(`Project ${key} is not in the XER file`);
    return found;
  }
  return projects.find((p) => tasks.some((t) => t.proj_id === p.proj_id)) ?? projects[0];
}

/** "CIV.FDN" style paths, leaving out the project's root node. */
function buildWbsPaths(rows: Row[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.wbs_id, r]));
  const paths = new Map<string, string>();
  const pathOf = (id: string, depth = 0): string => {
    const cached = paths.get(id);
    if (cached !== undefined) return cached;
    const r = byId.get(id);
    if (!r || r.proj_node_flag === "Y" || depth > 50) return "";
    const parent = pathOf(r.parent_wbs_id, depth + 1);
    const path = parent ? `${parent}.${r.wbs_short_name}` : r.wbs_short_name;
    paths.set(id, path);
    return path;
  };
  for (const id of byId.keys()) pathOf(id);
  for (const [id, path] of paths) if (!path) paths.delete(id);
  return paths;
}

/** "2026-01-05 08:00" -> "2026-01-05". */
function isoDate(value: string | undefined): string | undefined {
  const m = value && /^\d{4}-\d{2}-\d{2}/.exec(value.trim());
  return m ? m[0] : undefined;
}

function clampPct(x: number): number {
  return Math.min(100, Math.max(0, x));
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
