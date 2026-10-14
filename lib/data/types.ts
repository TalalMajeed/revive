/**
 * Records the app works with. They mirror the tables in
 * supabase/migrations (camelCase here, snake_case for the setup answers so
 * they line up with the project columns and the award model's features).
 * Dates are ISO strings (YYYY-MM-DD).
 */

import type { LinkType } from "@/lib/schedule";

export type ProjectType =
  | "building"
  | "road"
  | "bridge"
  | "water_sanitation"
  | "irrigation"
  | "power"
  | "other";
export type ClientType =
  | "federal_government"
  | "provincial_government"
  | "local_government"
  | "autonomous_body"
  | "donor"
  | "private";
export type FundingSource = "psdp" | "adp" | "foreign_aid" | "own_funds" | "private" | "mixed";
export type PecCategory = "CA" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
export type DesignStatus = "complete" | "partial" | "concept";
export type Province = "punjab" | "sindh" | "kp" | "balochistan" | "ict" | "gb" | "ajk";

/** The 12 setup answers, asked once in the setup wizard. */
export interface SetupAnswers {
  project_type: ProjectType | null;
  client_type: ClientType | null;
  funding_source: FundingSource | null;
  funding_secured_pct: number | null;
  contract_value_pkr: number | null;
  engineers_estimate_pkr: number | null;
  bidders_count: number | null;
  contract_start_date: string | null;
  original_completion_date: string | null;
  pec_category: PecCategory | null;
  design_status_at_award: DesignStatus | null;
  province: Province | null;
}

export interface Project {
  id: string;
  name: string;
  code?: string;
  location?: string;
  status: "active" | "completed";
  setup: SetupAnswers;
  scheduleSource: "xer" | "mspdi" | "demo";
  /** 0 = Sunday .. 6 = Saturday. */
  workingWeekdays: number[];
  /** First day of the schedule (offset 0 of the baseline). */
  scheduleStart: string;
  /** Status date of the imported schedule, before any weekly update. */
  importDataDate?: string;
  actualCompletionDate?: string;
  /** Seeded example; shown with a "demo" label. */
  isDemo?: boolean;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  code: string;
  name: string;
  wbs?: string;
  isMilestone: boolean;
  originalDurationDays: number;
  /** Remaining at import (for schedules imported part-way through). */
  remainingDurationDays: number;
  percentComplete: number;
  actualStart?: string;
  actualFinish?: string;
  /** As-planned dates from the baseline critical path. */
  baselineStart: string;
  baselineFinish: string;
  /** What the activity is, for crash options and reasons. */
  trade?: string;
}

export interface DependencyRecord {
  predecessorId: string;
  successorId: string;
  type: LinkType;
  lagDays: number;
}

export interface ActivityProgress {
  activityId: string;
  percentComplete: number;
  remainingDurationDays?: number;
  actualStart?: string;
  actualFinish?: string;
}

/** The 2-minute weekly form. Only activities that changed are listed. */
export interface ProgressUpdate {
  id: string;
  /** Monday of the reporting week. */
  weekStart: string;
  dataDate: string;
  activities: ActivityProgress[];
  notes?: string;
  createdAt: string;
}

export interface Payment {
  id: string;
  ipcNumber: number;
  amountClaimedPkr?: number;
  submittedOn?: string;
  amountCertifiedPkr?: number;
  certifiedOn?: string;
  /** Contractual due date for payment. */
  dueOn?: string;
  amountPaidPkr?: number;
  paidOn?: string;
}

export const DELAY_CATEGORIES = [
  "design_query",
  "drawing_delay",
  "variation_order",
  "payment_delay",
  "site_access",
  "material_shortage",
  "crew_shortage",
  "equipment_breakdown",
  "weather",
  "utility_shifting",
  "law_and_order",
  "other",
] as const;
export type DelayCategory = (typeof DELAY_CATEGORIES)[number];

export const RESPONSIBLE_PARTIES = [
  "client",
  "consultant",
  "contractor",
  "subcontractor",
  "supplier",
  "authority",
  "none",
] as const;
export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

/** A dated cause: the raw material of the EOT evidence pack. */
export interface WeeklyEvent {
  id: string;
  updateId?: string;
  activityId?: string;
  eventDate: string;
  category: DelayCategory;
  responsibleParty: ResponsibleParty;
  description: string;
  daysLost?: number;
  /** Letter, RFI or site-instruction number. */
  reference?: string;
  /** Open until resolved; open design queries widen the forecast. */
  resolvedOn?: string;
}

/** Why an activity slipped this week, picked in the weekly form. */
export interface SlipReason {
  id: string;
  updateId: string;
  activityId?: string;
  category: DelayCategory;
  responsibleParty: ResponsibleParty;
  daysSlipped?: number;
  note?: string;
}

export interface Reason {
  key: string;
  title: string;
  detail: string;
  owner: ResponsibleParty;
  action: string;
  /** Rough working days of delay this reason accounts for. */
  impactDays: number;
}

export interface ForecastRecord {
  id: string;
  updateId?: string;
  asOf: string;
  method: "simulation";
  targetDate: string;
  probabilityLate: number;
  deterministicFinish: string;
  p10: string;
  p50: string;
  p90: string;
  iterations: number;
  healthScore: number;
  reasons: Reason[];
  criticality: Record<string, number>;
  isLearning: boolean;
  createdAt: string;
}

export interface RecoveryAction {
  activityId: string;
  optionId: string;
  label: string;
  daysSaved: number;
  costPkr: number;
}

export interface RecoveryPlanRecord {
  id: string;
  forecastId?: string;
  status: "draft" | "accepted" | "rejected";
  budgetPkr?: number;
  targetFinish: string;
  newFinish: string;
  totalCostPkr: number;
  meetsTarget: boolean;
  actions: RecoveryAction[];
  createdAt: string;
}

/** Everything about one project, stored together. */
export interface ProjectBundle {
  project: Project;
  activities: ActivityRecord[];
  dependencies: DependencyRecord[];
  updates: ProgressUpdate[];
  payments: Payment[];
  events: WeeklyEvent[];
  slipReasons: SlipReason[];
  forecasts: ForecastRecord[];
  recoveryPlans: RecoveryPlanRecord[];
}

export const EMPTY_SETUP: SetupAnswers = {
  project_type: null,
  client_type: null,
  funding_source: null,
  funding_secured_pct: null,
  contract_value_pkr: null,
  engineers_estimate_pkr: null,
  bidders_count: null,
  contract_start_date: null,
  original_completion_date: null,
  pec_category: null,
  design_status_at_award: null,
  province: null,
};
