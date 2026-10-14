import type { ProjectBundle } from "@/lib/data/types";
import {
  computeCriticalPath,
  countWorkingDays,
  finishOffsetToDate,
  startOffsetToDate,
  type CriticalPathResult,
} from "@/lib/schedule";
import {
  baselineFinish,
  calendarOf,
  remainingNetwork,
  sortedUpdates,
  stateAt,
  targetDate,
  workingDaysBetween,
  type ProjectState,
} from "./state";

/**
 * The weekly schedule check: no model needed, schedule maths only. Days
 * behind, critical activities running late, float left, and earned schedule.
 */

export interface ActivityForecast {
  id: string;
  code: string;
  name: string;
  status: ProjectState["activities"][number]["status"];
  percentComplete: number;
  remaining: number;
  baselineStart: string;
  baselineFinish: string;
  /** Forecast dates (actual where known). */
  start: string;
  finish: string;
  /** Working days the finish has moved past the baseline finish. */
  slipDays: number;
  totalFloat: number;
  critical: boolean;
  isMilestone: boolean;
}

export interface WeeklyStatus {
  dataDate: string;
  updateIndex: number;
  state: ProjectState;
  cpm: CriticalPathResult;
  activities: ActivityForecast[];
  baselineFinish: string;
  targetDate: string;
  /** Finish with remaining work at its planned pace. */
  forecastFinish: string;
  /** Working days the forecast finish is past the target (negative = days in hand). */
  daysLate: number;
  /** Working days the forecast finish has moved since the baseline. */
  daysBehindBaseline: number;
  plannedPercent: number;
  actualPercent: number;
  /** Earned schedule, in working days from the schedule start. */
  earnedScheduleDays: number;
  actualTimeDays: number;
  /** Schedule performance index (time): 1 = on plan, 0.8 = 20% slow. */
  spiT: number;
}

export function weeklyStatus(bundle: ProjectBundle, updateIndex?: number): WeeklyStatus {
  const cal = calendarOf(bundle);
  const state = stateAt(bundle, updateIndex);
  const network = remainingNetwork(bundle, state);
  const target = targetDate(bundle);
  const targetOffset = countWorkingDays(cal, state.dataDate, target);
  const cpm = computeCriticalPath(network, { targetFinish: Math.max(targetOffset, 0) });
  const forecastFinish = finishOffsetToDate(cal, state.dataDate, cpm.projectFinish);
  const planned = baselineFinish(bundle);

  const activities: ActivityForecast[] = state.activities.map((s) => {
    const a = s.activity;
    const t = cpm.times[a.id];
    const start =
      s.actualStart ??
      (s.remaining > 0 ? startOffsetToDate(cal, state.dataDate, t.earlyStart) : finishOffsetToDate(cal, state.dataDate, t.earlyFinish));
    const finish = s.actualFinish ?? finishOffsetToDate(cal, state.dataDate, t.earlyFinish);
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      status: s.status,
      percentComplete: s.percentComplete,
      remaining: s.remaining,
      baselineStart: a.baselineStart,
      baselineFinish: a.baselineFinish,
      start,
      finish,
      slipDays: workingDaysBetween(cal, a.baselineFinish, finish),
      totalFloat: s.status === "complete" ? 0 : t.totalFloat,
      critical: s.status !== "complete" && t.critical,
      isMilestone: a.isMilestone,
    };
  });

  const progress = earnedSchedule(bundle, state);

  return {
    dataDate: state.dataDate,
    updateIndex: state.updateIndex,
    state,
    cpm,
    activities,
    baselineFinish: planned,
    targetDate: target,
    forecastFinish,
    daysLate: workingDaysBetween(cal, target, forecastFinish),
    daysBehindBaseline: workingDaysBetween(cal, planned, forecastFinish),
    ...progress,
  };
}

/**
 * Planned % complete at the start of a date, weighting activities by
 * original duration.
 */
export function plannedPercentAt(bundle: ProjectBundle, date: string): number {
  const cal = calendarOf(bundle);
  return plannedPercentAtOffset(bundle, Math.max(countWorkingDays(cal, bundle.project.scheduleStart, date) - 1, 0));
}

export function actualPercent(state: ProjectState): number {
  let total = 0;
  let done = 0;
  for (const s of state.activities) {
    const w = s.activity.originalDurationDays;
    if (w <= 0) continue;
    total += w;
    done += (w * s.percentComplete) / 100;
  }
  return total > 0 ? (100 * done) / total : 0;
}

function earnedSchedule(bundle: ProjectBundle, state: ProjectState) {
  const cal = calendarOf(bundle);
  const start = bundle.project.scheduleStart;
  const actual = actualPercent(state);
  // Working days elapsed before the data date.
  const atDays = Math.max(countWorkingDays(cal, start, state.dataDate) - 1, 0);
  const planned = plannedPercentAt(bundle, state.dataDate);

  // Earned schedule: the time at which the plan expected today's progress.
  const total = countWorkingDays(cal, start, baselineFinish(bundle));
  const curve = (t: number) => plannedPercentAtOffset(bundle, t);
  let es = 0;
  if (actual >= 100) {
    es = total;
  } else {
    let lo = 0;
    let hi = total;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (curve(mid) <= actual) lo = mid;
      else hi = mid;
    }
    es = lo;
  }
  return {
    plannedPercent: planned,
    actualPercent: actual,
    earnedScheduleDays: es,
    actualTimeDays: atDays,
    spiT: atDays > 0 ? es / atDays : 1,
  };
}

/** Planned % at a (fractional) working-day offset from the schedule start. */
function plannedPercentAtOffset(bundle: ProjectBundle, t: number): number {
  const cal = calendarOf(bundle);
  const start = bundle.project.scheduleStart;
  let total = 0;
  let done = 0;
  for (const a of bundle.activities) {
    const w = a.originalDurationDays;
    if (w <= 0) continue;
    const bs = offsetCache(bundle, a.baselineStart, () => countWorkingDays(cal, start, a.baselineStart) - 1);
    const bf = offsetCache(bundle, a.baselineFinish, () => countWorkingDays(cal, start, a.baselineFinish));
    total += w;
    done += w * clamp01((t - bs) / Math.max(bf - bs, 1e-9));
  }
  return total > 0 ? (100 * done) / total : 0;
}

const offsets = new WeakMap<ProjectBundle, Map<string, number>>();
function offsetCache(bundle: ProjectBundle, key: string, compute: () => number): number {
  let m = offsets.get(bundle);
  if (!m) offsets.set(bundle, (m = new Map()));
  let v = m.get(key);
  if (v === undefined) m.set(key, (v = compute()));
  return v;
}

/** S-curve: planned % weekly over the baseline, and actual % at each update. */
export function progressCurves(bundle: ProjectBundle, upTo?: number) {
  const cal = calendarOf(bundle);
  const start = bundle.project.scheduleStart;
  const end = baselineFinish(bundle);
  const total = countWorkingDays(cal, start, end);
  const planned: Array<{ date: string; percent: number }> = [];
  for (let t = 0; t <= total; t += 6) {
    planned.push({ date: startOffsetToDate(cal, start, t), percent: plannedPercentAtOffset(bundle, t) });
  }
  planned.push({ date: end, percent: 100 });

  const updates = sortedUpdates(bundle);
  const last = Math.min(upTo ?? updates.length - 1, updates.length - 1);
  const actual: Array<{ date: string; percent: number }> = [];
  for (let i = 0; i <= last; i++) {
    actual.push({ date: updates[i].dataDate, percent: actualPercent(stateAt(bundle, i)) });
  }
  return { planned, actual };
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
