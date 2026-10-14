import { loadEbm, predict, type EbmModel } from "./ebm";
import awardDemoJson from "./models/award-demo.json";

/**
 * Chance a project finishes late, from what is known at contract award (the
 * project setup answers), with the reasons behind it.
 *
 * The model in models/award-demo.json is a DEMO trained on synthetic rows by
 * training/make_award_demo_data.py. Its numbers are not evidence about real
 * projects; it is here so the pipeline works end to end until a model trained
 * on real finished projects replaces it. Results say so with isDemoModel.
 */

export const PROJECT_TYPE_LABELS = {
  building: "Building",
  road: "Road",
  bridge: "Bridge",
  water_sanitation: "Water and sanitation",
  irrigation: "Irrigation",
  power: "Power",
  other: "Other",
} as const;

export const CLIENT_TYPE_LABELS = {
  federal_government: "Federal government",
  provincial_government: "Provincial government",
  local_government: "Local government",
  autonomous_body: "Autonomous body",
  donor: "Donor agency",
  private: "Private client",
} as const;

export const FUNDING_SOURCE_LABELS = {
  psdp: "PSDP (federal development budget)",
  adp: "ADP (provincial development budget)",
  foreign_aid: "Foreign aid",
  own_funds: "Client's own funds",
  private: "Private finance",
  mixed: "Mixed sources",
} as const;

export const PEC_CATEGORY_LABELS = {
  CA: "CA",
  C1: "C1",
  C2: "C2",
  C3: "C3",
  C4: "C4",
  C5: "C5",
  C6: "C6",
} as const;

export const DESIGN_STATUS_LABELS = {
  complete: "complete",
  partial: "partial",
  concept: "concept only",
} as const;

export const PROVINCE_LABELS = {
  punjab: "Punjab",
  sindh: "Sindh",
  kp: "Khyber Pakhtunkhwa",
  balochistan: "Balochistan",
  ict: "Islamabad Capital Territory",
  gb: "Gilgit-Baltistan",
  ajk: "Azad Jammu and Kashmir",
} as const;

export type ProjectType = keyof typeof PROJECT_TYPE_LABELS;
export type ClientType = keyof typeof CLIENT_TYPE_LABELS;
export type FundingSource = keyof typeof FUNDING_SOURCE_LABELS;
export type PecCategory = keyof typeof PEC_CATEGORY_LABELS;
export type DesignStatus = keyof typeof DESIGN_STATUS_LABELS;
export type Province = keyof typeof PROVINCE_LABELS;

/** A project's setup answers. Anything can be missing. */
export interface AwardSetup {
  project_type?: ProjectType | string | null;
  client_type?: ClientType | string | null;
  funding_source?: FundingSource | string | null;
  /** 0 to 100. */
  funding_secured_pct?: number | null;
  contract_value_pkr?: number | null;
  engineers_estimate_pkr?: number | null;
  bidders_count?: number | null;
  /** YYYY-MM-DD. */
  contract_start_date?: string | null;
  /** YYYY-MM-DD, the completion date in the contract as signed. */
  original_completion_date?: string | null;
  pec_category?: PecCategory | string | null;
  design_status_at_award?: DesignStatus | string | null;
  province?: Province | string | null;
}

/** The model's input row; null is a missing value. */
export interface AwardFeatureRow {
  [feature: string]: string | number | null;
  project_type: string | null;
  client_type: string | null;
  funding_source: string | null;
  funding_secured_pct: number | null;
  contract_value_pkr: number | null;
  /** Contract value / engineer's estimate. */
  bid_to_estimate: number | null;
  bidders_count: number | null;
  /** Calendar days from contract start to original completion. */
  planned_duration_days: number | null;
  pec_category: string | null;
  design_status_at_award: string | null;
  province: string | null;
}

export interface AwardReason {
  /** Model feature, or "a & b" for a pair. */
  feature: string;
  /** Plain English, e.g. "Funding secured: 40%". */
  label: string;
  /** Contribution to the log-odds of finishing late. */
  score: number;
  direction: "raises" | "lowers";
}

export interface AwardRisk {
  probabilityLate: number;
  /** Up to five, largest effect first. */
  reasons: AwardReason[];
  isDemoModel: true;
}

function finite(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function code(v: string | null | undefined, upper = false): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  return upper ? t.toUpperCase() : t.toLowerCase();
}

/** Days since the epoch for a valid YYYY-MM-DD, otherwise null. */
function dayNumber(date: string | null | undefined): number | null {
  if (typeof date !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return Math.round(ms / 86_400_000);
}

/** Maps setup answers to the award model's feature row. */
export function awardFeatures(project: AwardSetup): AwardFeatureRow {
  const contract = finite(project.contract_value_pkr);
  const estimate = finite(project.engineers_estimate_pkr);
  const start = dayNumber(project.contract_start_date);
  const finish = dayNumber(project.original_completion_date);
  return {
    project_type: code(project.project_type),
    client_type: code(project.client_type),
    funding_source: code(project.funding_source),
    funding_secured_pct: finite(project.funding_secured_pct),
    contract_value_pkr: contract,
    bid_to_estimate: contract !== null && estimate !== null && contract > 0 && estimate > 0 ? contract / estimate : null,
    bidders_count: finite(project.bidders_count),
    planned_duration_days: start !== null && finish !== null && finish > start ? finish - start : null,
    pec_category: code(project.pec_category, true),
    design_status_at_award: code(project.design_status_at_award),
    province: code(project.province),
  };
}

function trim(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

function formatPkr(v: number): string {
  if (Math.abs(v) >= 1e9) return `PKR ${trim(v / 1e9, 2)} billion`;
  if (Math.abs(v) >= 1e6) return `PKR ${trim(v / 1e6, 1)} million`;
  return `PKR ${Math.round(v).toLocaleString("en-US")}`;
}

function categoryLabel(labels: Record<string, string>, v: string): string {
  return Object.hasOwn(labels, v) ? labels[v] : v;
}

const FEATURE_NAMES: Record<string, string> = {
  project_type: "Project type",
  client_type: "Client",
  funding_source: "Funding source",
  funding_secured_pct: "Funding secured",
  contract_value_pkr: "Contract value",
  bid_to_estimate: "Bid against engineer's estimate",
  bidders_count: "Bidders",
  planned_duration_days: "Planned duration",
  pec_category: "Contractor PEC category",
  design_status_at_award: "Design at award",
  province: "Location",
};

/** Plain-English label for one feature's value, e.g. "Design at award: concept only". */
export function awardFeatureLabel(feature: string, value: string | number | null | undefined): string {
  const name = FEATURE_NAMES[feature] ?? feature;
  if (value === null || value === undefined || value === "") return `${name}: not given`;

  if (typeof value === "number") {
    switch (feature) {
      case "funding_secured_pct":
        return `${name}: ${trim(value, 1)}%`;
      case "contract_value_pkr":
        return `${name}: ${formatPkr(value)}`;
      case "bid_to_estimate": {
        const pct = Math.round((value - 1) * 100);
        if (pct === 0) return "Bid equal to the engineer's estimate";
        return `Bid ${Math.abs(pct)}% ${pct < 0 ? "below" : "above"} the engineer's estimate`;
      }
      case "bidders_count":
        return `${name}: ${trim(value, 0)}`;
      case "planned_duration_days": {
        const months = Math.round(value / 30.44);
        return `${name}: ${trim(value, 0)} days (about ${months} month${months === 1 ? "" : "s"})`;
      }
      default:
        return `${name}: ${value}`;
    }
  }

  const labels: Record<string, Record<string, string>> = {
    project_type: PROJECT_TYPE_LABELS,
    client_type: CLIENT_TYPE_LABELS,
    funding_source: FUNDING_SOURCE_LABELS,
    pec_category: PEC_CATEGORY_LABELS,
    design_status_at_award: DESIGN_STATUS_LABELS,
    province: PROVINCE_LABELS,
  };
  return `${name}: ${labels[feature] ? categoryLabel(labels[feature], value) : value}`;
}

let cached: EbmModel | undefined;

function awardModel(): EbmModel {
  cached ??= loadEbm(awardDemoJson);
  return cached;
}

export const AWARD_REASON_COUNT = 5;

/** Chance of finishing late and the top reasons, from the DEMO award model. */
export function predictAwardRisk(project: AwardSetup): AwardRisk {
  const row = awardFeatures(project);
  const p = predict(awardModel(), row);
  const reasons = p.contributions
    .filter((c) => c.score !== 0)
    .slice(0, AWARD_REASON_COUNT)
    .map(
      (c): AwardReason => ({
        feature: c.term,
        label: c.features.map((f) => awardFeatureLabel(f, row[f])).join(" and "),
        score: c.score,
        direction: c.score > 0 ? "raises" : "lowers",
      }),
    );
  return { probabilityLate: p.value, reasons, isDemoModel: true };
}
