/**
 * Schedule model shared by the importers, the critical-path engine and the
 * simulation. Durations and lags are in working days.
 */

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface Activity {
  id: string;
  name: string;
  /** Working days still to do. 0 for a completed activity or a milestone. */
  duration: number;
  /** Earliest the activity may start, in working days from the data date. */
  earliestStart?: number;
}

export interface Dependency {
  predecessorId: string;
  successorId: string;
  type: LinkType;
  /** Working days; negative is a lead. */
  lag: number;
}

export interface ScheduleNetwork {
  activities: Activity[];
  dependencies: Dependency[];
}

export type ActivityStatus = "not_started" | "in_progress" | "complete";

/** An activity as read from a schedule file, before it goes into the engine. */
export interface ImportedActivity extends Activity {
  /** Activity ID shown in the source tool (P6 task code, MS Project ID). */
  code: string;
  wbs?: string;
  isMilestone: boolean;
  status: ActivityStatus;
  originalDuration: number;
  percentComplete: number;
  plannedStart?: string;
  plannedFinish?: string;
  actualStart?: string;
  actualFinish?: string;
}

export interface ImportedSchedule {
  source: "xer" | "mspdi";
  projectName: string;
  /** ISO date (YYYY-MM-DD). */
  plannedStart?: string;
  plannedFinish?: string;
  /** Status date the progress was recorded at. */
  dataDate?: string;
  activities: ImportedActivity[];
  dependencies: Dependency[];
  /** Things skipped or approximated during import, for the user to review. */
  warnings: string[];
}
