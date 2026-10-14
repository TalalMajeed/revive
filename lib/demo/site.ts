import type {
  ActivityProgress,
  ActivityRecord,
  DelayCategory,
  DependencyRecord,
  Payment,
  ProgressUpdate,
  ProjectBundle,
  Project,
  ResponsibleParty,
  SlipReason,
  WeeklyEvent,
} from "@/lib/data/types";
import { withBaseline } from "@/lib/progress/state";
import { addCalendarDays, isWorkingDay, parseIsoDate, type LinkType, type WorkCalendar } from "@/lib/schedule";

/**
 * Builds an illustrative project history by "running the site" day by day:
 * each activity progresses one working day of work per day, slowed or held
 * by scripted disruptions (late payments, open RFIs, monsoon, Eid). Every
 * Monday the progress is written down as a weekly update, with slip reasons
 * for the days lost. The result is a consistent demo, not real data.
 */

export interface DemoActivity {
  code: string;
  name: string;
  duration: number;
  trade: string;
  preds?: Array<[code: string, type?: LinkType, lag?: number]>;
}

export interface Disruption {
  from: string;
  to: string;
  /** Share of a normal day's work done while active (0 = stopped). */
  factor: number;
  /** Activity codes or trades affected; all activities if neither is given. */
  codes?: string[];
  trades?: string[];
  category: DelayCategory;
  party: ResponsibleParty;
  note?: string;
  /** Public holidays: lost days but no slip reason. */
  holiday?: boolean;
}

export interface DemoEvent extends Omit<WeeklyEvent, "id" | "activityId" | "updateId"> {
  activityCode?: string;
}

export interface DemoSpec {
  project: Omit<Project, "workingWeekdays" | "status" | "createdAt" | "isDemo" | "scheduleSource" | "actualCompletionDate">;
  activities: DemoActivity[];
  /** True duration as a multiple of the planned one (default 1). */
  overrun?: Record<string, number>;
  disruptions: Disruption[];
  events: DemoEvent[];
  payments: Payment[];
  /** Last data date to record; omit to run until the project finishes. */
  cutoff?: string;
}

const SIX_DAY: WorkCalendar = { workingWeekdays: [1, 2, 3, 4, 5, 6] };

interface Track {
  work: number;
  trueDuration: number;
  startDay?: number;
  finishDay?: number;
  lostThisWeek: Map<Disruption, number>;
}

export function buildDemoBundle(spec: DemoSpec): ProjectBundle {
  const start = spec.project.scheduleStart;
  const dependencies: DependencyRecord[] = spec.activities.flatMap((a) =>
    (a.preds ?? []).map(([code, type = "FS", lag = 0]) => ({
      predecessorId: code,
      successorId: a.code,
      type,
      lagDays: lag,
    })),
  );
  const activities: ActivityRecord[] = withBaseline(
    spec.activities.map((a) => ({
      id: a.code,
      code: a.code,
      name: a.name,
      trade: a.trade,
      isMilestone: a.duration === 0,
      originalDurationDays: a.duration,
      remainingDurationDays: a.duration,
      percentComplete: 0,
    })),
    dependencies,
    start,
    SIX_DAY,
  );

  const project: Project = {
    ...spec.project,
    status: "active",
    scheduleSource: "demo",
    workingWeekdays: SIX_DAY.workingWeekdays,
    isDemo: true,
    createdAt: `${start}T09:00:00.000Z`,
  };

  const tracks = new Map<string, Track>(
    spec.activities.map((a) => [
      a.code,
      { work: 0, trueDuration: a.duration * (spec.overrun?.[a.code] ?? 1), lostThisWeek: new Map() },
    ]),
  );
  const preds = new Map(spec.activities.map((a) => [a.code, a.preds ?? []]));
  const trade = new Map(spec.activities.map((a) => [a.code, a.trade]));
  const order = topological(spec.activities);

  const dayDate: string[] = [];
  const updates: ProgressUpdate[] = [];
  const slipReasons: SlipReason[] = [];
  const lastReported = new Map<string, string>();
  let date = start;
  let day = -1;
  let finished = false;

  for (let guard = 0; guard < 3000 && !finished; guard++) {
    // Weekly update every Monday after the first week.
    if (parseIsoDate(date) > parseIsoDate(start) && new Date(parseIsoDate(date)).getUTCDay() === 1) {
      if (spec.cutoff && date > spec.cutoff) break;
      const update = snapshot(date, tracks, dayDate, lastReported);
      updates.push(update);
      for (const [code, t] of tracks) {
        for (const [d, lost] of t.lostThisWeek) {
          if (lost >= 1 && !d.holiday) {
            slipReasons.push({
              id: `${update.id}:${code}:${d.category}`,
              updateId: update.id,
              activityId: code,
              category: d.category,
              responsibleParty: d.party,
              daysSlipped: Math.round(lost * 2) / 2,
              note: d.note,
            });
          }
        }
        t.lostThisWeek.clear();
      }
      finished = [...tracks.values()].every((t) => t.finishDay !== undefined);
      if (finished) break;
    }

    if (isWorkingDay(SIX_DAY, date)) {
      day++;
      dayDate[day] = date;
      const active = spec.disruptions.filter((d) => d.from <= date && date <= d.to);
      for (const code of order) {
        const t = tracks.get(code)!;
        if (t.finishDay !== undefined) continue;
        const ps = preds.get(code)!;
        const ready = ps.every(([p, type = "FS", lag = 0]) => {
          const pt = tracks.get(p)!;
          if (type === "FS") return pt.finishDay !== undefined && day > pt.finishDay + lag;
          if (type === "SS") return pt.startDay !== undefined && day >= pt.startDay + lag;
          return true;
        });
        if (!ready) continue;

        if (t.trueDuration === 0) {
          t.startDay = t.finishDay = day;
          continue;
        }

        let factor = 1;
        for (const d of active) {
          const hits = (!d.codes && !d.trades) || d.codes?.includes(code) || d.trades?.includes(trade.get(code)!);
          if (!hits) continue;
          factor *= d.factor;
          t.lostThisWeek.set(d, (t.lostThisWeek.get(d) ?? 0) + (1 - d.factor));
        }
        if (factor <= 0) continue;
        if (t.startDay === undefined) t.startDay = day;
        t.work += factor;

        const ffHeld = ps.some(([p, type, lag = 0]) => {
          const pt = tracks.get(p)!;
          return type === "FF" && (pt.finishDay === undefined || day < pt.finishDay + lag);
        });
        if (t.work >= t.trueDuration - 1e-9) {
          if (ffHeld) t.work = t.trueDuration - 0.01;
          else t.finishDay = day;
        }
      }
    }
    date = addCalendarDays(date, 1);
  }

  const finishDays = [...tracks.values()].map((t) => t.finishDay);
  const complete = finishDays.every((d) => d !== undefined);
  if (complete) {
    project.status = "completed";
    project.actualCompletionDate = dayDate[Math.max(...(finishDays as number[]))];
  }

  // The first weekly update on or after the event, where it was reported.
  const updateFor = (d: string) => updates.find((u) => u.dataDate >= d) ?? updates[updates.length - 1];
  const events: WeeklyEvent[] = spec.events
    .filter((e) => !spec.cutoff || e.eventDate <= spec.cutoff)
    .map((e, i) => {
      const { activityCode, ...rest } = e;
      const resolved = rest.resolvedOn && spec.cutoff && rest.resolvedOn > spec.cutoff ? undefined : rest.resolvedOn;
      return {
        ...rest,
        resolvedOn: resolved,
        id: `${project.id}-ev${i + 1}`,
        activityId: activityCode,
        updateId: updateFor(e.eventDate)?.id,
      };
    });

  const payments = spec.payments
    .filter((p) => !spec.cutoff || !p.submittedOn || p.submittedOn <= spec.cutoff)
    .map((p) => ({
      ...p,
      certifiedOn: spec.cutoff && p.certifiedOn && p.certifiedOn > spec.cutoff ? undefined : p.certifiedOn,
      paidOn: spec.cutoff && p.paidOn && p.paidOn > spec.cutoff ? undefined : p.paidOn,
      amountPaidPkr: spec.cutoff && p.paidOn && p.paidOn > spec.cutoff ? undefined : p.amountPaidPkr,
    }));

  return {
    project,
    activities,
    dependencies,
    updates,
    payments,
    events,
    slipReasons,
    forecasts: [],
    recoveryPlans: [],
  };
}

function snapshot(
  dataDate: string,
  tracks: Map<string, Track>,
  dayDate: string[],
  lastReported: Map<string, string>,
): ProgressUpdate {
  const activities: ActivityProgress[] = [];
  for (const [code, t] of tracks) {
    if (t.startDay === undefined) continue;
    const done = t.finishDay !== undefined;
    const pct = done ? 100 : Math.min(99, Math.floor((t.work / t.trueDuration) * 100));
    const entry: ActivityProgress = {
      activityId: code,
      percentComplete: pct,
      actualStart: dayDate[t.startDay],
      actualFinish: done ? dayDate[t.finishDay!] : undefined,
    };
    const key = JSON.stringify(entry);
    if (lastReported.get(code) === key) continue;
    lastReported.set(code, key);
    activities.push(entry);
  }
  return {
    id: `u-${dataDate}`,
    weekStart: addCalendarDays(dataDate, -7),
    dataDate,
    activities,
    createdAt: `${dataDate}T08:00:00.000Z`,
  };
}

function topological(activities: DemoActivity[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const byCode = new Map(activities.map((a) => [a.code, a]));
  const visit = (code: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    for (const [p] of byCode.get(code)?.preds ?? []) visit(p);
    out.push(code);
  };
  activities.forEach((a) => visit(a.code));
  return out;
}
