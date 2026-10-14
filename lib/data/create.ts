import { forecastWeek } from "@/lib/progress/forecast";
import { withBaseline } from "@/lib/progress/state";
import { SIX_DAY_WEEK, type ImportedSchedule } from "@/lib/schedule";
import type { ProjectBundle, SetupAnswers } from "./types";

export interface NewProjectInput {
  id: string;
  name: string;
  code?: string;
  location?: string;
  setup: SetupAnswers;
  schedule: ImportedSchedule;
  now?: Date;
}

/**
 * A project from the setup wizard: the imported schedule becomes the
 * baseline (as-planned dates from the contract start), and the first
 * forecast is logged straight away.
 */
export function createProjectBundle(input: NewProjectInput): ProjectBundle {
  const { schedule } = input;
  const today = (input.now ?? new Date()).toISOString().slice(0, 10);
  const scheduleStart = input.setup.contract_start_date ?? schedule.plannedStart ?? today;
  const setup: SetupAnswers = {
    ...input.setup,
    contract_start_date: scheduleStart,
    original_completion_date: input.setup.original_completion_date ?? schedule.plannedFinish ?? null,
  };

  const dependencies = schedule.dependencies.map((d) => ({
    predecessorId: d.predecessorId,
    successorId: d.successorId,
    type: d.type,
    lagDays: d.lag,
  }));
  const activities = withBaseline(
    schedule.activities.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      wbs: a.wbs,
      isMilestone: a.isMilestone,
      originalDurationDays: a.originalDuration,
      remainingDurationDays: a.duration,
      percentComplete: a.percentComplete,
      actualStart: a.actualStart,
      actualFinish: a.actualFinish,
    })),
    dependencies,
    scheduleStart,
    SIX_DAY_WEEK,
  );

  const bundle: ProjectBundle = {
    project: {
      id: input.id,
      name: input.name.trim(),
      code: input.code?.trim() || undefined,
      location: input.location?.trim() || undefined,
      status: "active",
      setup,
      scheduleSource: schedule.source,
      workingWeekdays: SIX_DAY_WEEK.workingWeekdays,
      scheduleStart,
      importDataDate: schedule.dataDate && schedule.dataDate > scheduleStart ? schedule.dataDate : scheduleStart,
      createdAt: (input.now ?? new Date()).toISOString(),
    },
    activities,
    dependencies,
    updates: [],
    payments: [],
    events: [],
    slipReasons: [],
    forecasts: [],
    recoveryPlans: [],
  };
  return { ...bundle, forecasts: [forecastWeek(bundle).record] };
}
