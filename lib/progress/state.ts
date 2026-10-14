import type { ActivityRecord, DependencyRecord, ProjectBundle } from "@/lib/data/types";
import {
  computeCriticalPath,
  countWorkingDays,
  finishOffsetToDate,
  startOffsetToDate,
  type ActivityStatus,
  type ScheduleNetwork,
  type WorkCalendar,
} from "@/lib/schedule";

/**
 * Where every activity stands at a given week: the baseline activities with
 * all weekly updates up to that week folded in.
 */

export interface ActivityState {
  activity: ActivityRecord;
  status: ActivityStatus;
  percentComplete: number;
  /** Working days still to do. */
  remaining: number;
  actualStart?: string;
  actualFinish?: string;
}

export interface ProjectState {
  dataDate: string;
  /** Index of the last update included, or -1 for the schedule as imported. */
  updateIndex: number;
  activities: ActivityState[];
}

export function calendarOf(bundle: ProjectBundle): WorkCalendar {
  return { workingWeekdays: bundle.project.workingWeekdays };
}

/** Updates sorted by data date (oldest first). */
export function sortedUpdates(bundle: ProjectBundle) {
  return [...bundle.updates].sort((a, b) => a.dataDate.localeCompare(b.dataDate));
}

/**
 * State after the update at `updateIndex` (in data-date order). Defaults to
 * the latest update.
 */
export function stateAt(bundle: ProjectBundle, updateIndex?: number): ProjectState {
  const updates = sortedUpdates(bundle);
  const last = Math.min(updateIndex ?? updates.length - 1, updates.length - 1);

  const current = new Map<string, ActivityState>();
  for (const a of bundle.activities) {
    current.set(a.id, classify(a, {
      percentComplete: a.percentComplete,
      remaining: a.remainingDurationDays,
      actualStart: a.actualStart,
      actualFinish: a.actualFinish,
    }));
  }

  for (let i = 0; i <= last; i++) {
    for (const p of updates[i].activities) {
      const prev = current.get(p.activityId);
      if (!prev) continue;
      const a = prev.activity;
      const pct = clampPct(p.percentComplete);
      current.set(a.id, classify(a, {
        percentComplete: pct,
        remaining: p.remainingDurationDays ?? round(a.originalDurationDays * (1 - pct / 100)),
        actualStart: p.actualStart ?? prev.actualStart,
        actualFinish: p.actualFinish ?? (pct >= 100 ? prev.actualFinish ?? updates[i].dataDate : undefined),
      }));
    }
  }

  const dataDate =
    last >= 0
      ? updates[last].dataDate
      : bundle.project.importDataDate ?? bundle.project.scheduleStart;

  return { dataDate, updateIndex: last, activities: bundle.activities.map((a) => current.get(a.id)!) };
}

function classify(
  activity: ActivityRecord,
  s: { percentComplete: number; remaining: number; actualStart?: string; actualFinish?: string },
): ActivityState {
  const done = s.percentComplete >= 100 || !!s.actualFinish;
  const started = done || s.percentComplete > 0 || !!s.actualStart;
  return {
    activity,
    status: done ? "complete" : started ? "in_progress" : "not_started",
    percentComplete: done ? 100 : s.percentComplete,
    remaining: done || activity.isMilestone ? 0 : Math.max(0, s.remaining),
    actualStart: s.actualStart,
    actualFinish: done ? s.actualFinish : undefined,
  };
}

/**
 * The work left, as a network for the critical path and the simulation.
 * Links from or into finished activities are history and are dropped, so a
 * finished predecessor's lag no longer holds anything up.
 */
export function remainingNetwork(bundle: ProjectBundle, state: ProjectState): ScheduleNetwork {
  const complete = new Set(state.activities.filter((s) => s.status === "complete").map((s) => s.activity.id));
  return {
    activities: state.activities.map((s) => ({
      id: s.activity.id,
      name: s.activity.name,
      duration: s.remaining,
    })),
    dependencies: bundle.dependencies
      .filter((d) => !complete.has(d.predecessorId) && !complete.has(d.successorId))
      .map(toDependency),
  };
}

export function toDependency(d: DependencyRecord) {
  return { predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lag: d.lagDays };
}

/**
 * As-planned dates: the critical path on original durations from the
 * schedule start. Returns the activities with baseline dates filled in.
 */
export function withBaseline(
  activities: Omit<ActivityRecord, "baselineStart" | "baselineFinish">[],
  dependencies: DependencyRecord[],
  scheduleStart: string,
  calendar: WorkCalendar,
): ActivityRecord[] {
  const cpm = computeCriticalPath({
    activities: activities.map((a) => ({ id: a.id, name: a.name, duration: a.originalDurationDays })),
    dependencies: dependencies.map(toDependency),
  });
  return activities.map((a) => {
    const t = cpm.times[a.id];
    const finish = finishOffsetToDate(calendar, scheduleStart, t.earlyFinish);
    return {
      ...a,
      baselineStart: a.originalDurationDays > 0 ? startOffsetToDate(calendar, scheduleStart, t.earlyStart) : finish,
      baselineFinish: finish,
    };
  });
}

export function baselineFinish(bundle: ProjectBundle): string {
  return bundle.activities.reduce(
    (max, a) => (a.baselineFinish > max ? a.baselineFinish : max),
    bundle.project.scheduleStart,
  );
}

/** The date "late" is measured against: the contract completion date. */
export function targetDate(bundle: ProjectBundle): string {
  return bundle.project.setup.original_completion_date ?? baselineFinish(bundle);
}

/** Working days from a to b: positive when b is after a. */
export function workingDaysBetween(calendar: WorkCalendar, a: string, b: string): number {
  if (a === b) return 0;
  return b > a ? countWorkingDays(calendar, a, b) - 1 : -(countWorkingDays(calendar, b, a) - 1);
}

function clampPct(x: number) {
  return Math.min(100, Math.max(0, x));
}

function round(x: number) {
  return Math.round(x * 100) / 100;
}
