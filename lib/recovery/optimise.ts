import loadHighs, { type Highs } from "highs";
import { computeCriticalPath } from "../schedule/cpm";
import type { ScheduleNetwork } from "../schedule/types";

/**
 * Recovery optimiser: the cheapest way to pull a late project back to a
 * target finish ("crashing", the time–cost trade-off), solved as a linear
 * program with HiGHS.
 *
 * Each activity's remaining duration d becomes d − Σ x_k, where x_k is the
 * number of days bought with speed-up option k (overtime, an extra crew…),
 * 0 ≤ x_k ≤ maxDaysSaved, at costPerDayPkr per day. Savings are continuous, so
 * a fraction of a day is allowed, and an activity never goes below zero.
 *
 * Variables (safe LP names; activity ids never appear in the LP text):
 *   s{i}     start of activity i, ≥ max(0, earliestStart)
 *   x{i}_{k} days saved on activity i by its option k
 *   fin      project finish
 * Constraints, with D_i = d_i − Σ_k x{i}_{k}:
 *   FS  s_j ≥ s_i + D_i + lag        SS  s_j ≥ s_i + lag
 *   FF  s_j + D_j ≥ s_i + D_i + lag  SF  s_j + D_j ≥ s_i + lag
 *   fin ≥ s_j + D_j for every activity, Σ_k x{j}_{k} ≤ d_j.
 *
 * Mode 1: minimise cost with fin ≤ target (and cost ≤ budget if given).
 * Mode 2, when that is infeasible: minimise fin (within the budget, if any),
 * then minimise cost at that finish.
 */

export interface CrashOption {
  id: string;
  label: string;
  /** Most working days this option can take off the activity. */
  maxDaysSaved: number;
  costPerDayPkr: number;
}

export interface RecoveryInput {
  network: ScheduleNetwork;
  /** Speed-up options keyed by activity id. Activities not listed can't be crashed. */
  options: Record<string, CrashOption[]>;
  /** Working days from the data date. */
  targetFinish: number;
  budgetPkr?: number;
}

export interface RecoveryAction {
  activityId: string;
  optionId: string;
  label: string;
  daysSaved: number;
  costPkr: number;
}

export interface RecoveryResult {
  status: "optimal" | "infeasible" | "error";
  /** True when the new finish is on or before the target. */
  meetsTarget: boolean;
  originalFinish: number;
  newFinish: number;
  totalCostPkr: number;
  /** Nonzero savings only, most expensive first. */
  actions: RecoveryAction[];
  message?: string;
}

/** Slack allowed when comparing finishes computed by the LP and by CPM. */
const TIME_TOLERANCE = 1e-6;
/** Savings smaller than this are solver noise. */
const ZERO_DAYS = 1e-7;

let highsPromise: Promise<Highs> | null = null;

/** Loads the HiGHS WebAssembly module once per process. */
function getHighs(): Promise<Highs> {
  if (!highsPromise) {
    highsPromise = loadHighs().catch((err: unknown) => {
      highsPromise = null; // let a later call retry
      throw err;
    });
  }
  return highsPromise;
}

/**
 * Checks the input for problems that make it unsolvable (bad numbers, unknown
 * activity ids, loops in the logic). Returns a message, or null when fine.
 */
export function checkRecoveryInput(input: RecoveryInput): string | null {
  const { network, options, targetFinish, budgetPkr } = input;
  if (!Number.isFinite(targetFinish)) return "targetFinish must be a finite number of working days";
  if (budgetPkr !== undefined && !(Number.isFinite(budgetPkr) && budgetPkr >= 0)) {
    return "budgetPkr must be a number of rupees, zero or more";
  }
  try {
    computeCriticalPath(network);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  for (const d of network.dependencies) {
    if (!Number.isFinite(d.lag)) return `Link ${d.predecessorId} → ${d.successorId} has an invalid lag`;
    if (!["FS", "SS", "FF", "SF"].includes(d.type)) {
      return `Link ${d.predecessorId} → ${d.successorId} has an unknown type: ${String(d.type)}`;
    }
  }
  for (const a of network.activities) {
    if (!Number.isFinite(a.duration)) return `Activity ${a.id} has an invalid duration`;
    if (a.earliestStart !== undefined && !Number.isFinite(a.earliestStart)) {
      return `Activity ${a.id} has an invalid earliest start`;
    }
  }
  const ids = new Set(network.activities.map((a) => a.id));
  for (const [activityId, list] of Object.entries(options)) {
    if (!ids.has(activityId)) return `Speed-up options given for unknown activity: ${activityId}`;
    if (!Array.isArray(list)) return `Speed-up options for ${activityId} must be a list`;
    for (const o of list) {
      if (!(Number.isFinite(o.maxDaysSaved) && o.maxDaysSaved >= 0)) {
        return `Option ${o.id} on ${activityId}: maxDaysSaved must be zero or more`;
      }
      if (!(Number.isFinite(o.costPerDayPkr) && o.costPerDayPkr >= 0)) {
        return `Option ${o.id} on ${activityId}: costPerDayPkr must be zero or more`;
      }
    }
  }
  return null;
}

interface OptionVar {
  name: string;
  activity: number;
  option: CrashOption;
}

type Term = [coefficient: number, variable: string];

interface LpSpec {
  objective: "cost" | "finish";
  /** Upper bound on fin. */
  finishAtMost?: number;
  budgetPkr?: number;
}

type Solved =
  | { kind: "optimal"; values: Map<string, number> }
  | { kind: "infeasible" }
  | { kind: "error"; message: string };

/** The LP rows that only depend on the network, built once per call. */
class CrashModel {
  readonly vars: OptionVar[] = [];
  /** Option variables of each activity. */
  readonly byActivity: OptionVar[][];
  private readonly rows: string[] = [];
  private readonly bounds: string[] = [];
  private readonly tieBreak: number;

  constructor(private readonly input: RecoveryInput) {
    const { network, options } = input;
    const indexOf = new Map(network.activities.map((a, i) => [a.id, i]));
    this.byActivity = network.activities.map((a, i) => {
      const list = Object.hasOwn(options, a.id) ? options[a.id] : [];
      return list
        .map((option, k) => ({ name: `x${i}_${k}`, activity: i, option }))
        .filter((v) => v.option.maxDaysSaved > 0 && a.duration > 0);
    });
    for (const list of this.byActivity) this.vars.push(...list);

    // A tiny cost per day saved, so options that cost nothing aren't used
    // for no reason. Far below any real price difference.
    const positive = this.vars.map((v) => v.option.costPerDayPkr).filter((c) => c > 0);
    this.tieBreak = 1e-6 * (positive.length > 0 ? Math.min(...positive) : 1);

    const savings = (i: number, sign: number): Term[] =>
      this.byActivity[i].map((v) => [sign, v.name]);

    network.dependencies.forEach((dep, n) => {
      const i = indexOf.get(dep.predecessorId)!;
      const j = indexOf.get(dep.successorId)!;
      const di = network.activities[i].duration;
      const dj = network.activities[j].duration;
      const si: Term = [-1, `s${i}`];
      const sj: Term = [1, `s${j}`];
      let terms: Term[];
      let rhs: number;
      switch (dep.type) {
        case "FS": // s_j - s_i + X_i >= d_i + lag
          terms = [sj, si, ...savings(i, 1)];
          rhs = di + dep.lag;
          break;
        case "SS": // s_j - s_i >= lag
          terms = [sj, si];
          rhs = dep.lag;
          break;
        case "FF": // s_j - X_j - s_i + X_i >= d_i - d_j + lag
          terms = [sj, ...savings(j, -1), si, ...savings(i, 1)];
          rhs = di - dj + dep.lag;
          break;
        default: // SF: s_j - X_j - s_i >= lag - d_j
          terms = [sj, ...savings(j, -1), si];
          rhs = dep.lag - dj;
      }
      this.rows.push(row(`l${n}`, terms, ">=", rhs));
    });

    network.activities.forEach((a, j) => {
      // fin - s_j + X_j >= d_j
      this.rows.push(row(`f${j}`, [[1, "fin"], [-1, `s${j}`], ...savings(j, 1)], ">=", a.duration));
      const vars = this.byActivity[j];
      const most = vars.reduce((sum, v) => sum + v.option.maxDaysSaved, 0);
      if (vars.length > 1 && most > a.duration) {
        this.rows.push(row(`c${j}`, savings(j, 1), "<=", a.duration));
      }
      this.bounds.push(` s${j} >= ${num(Math.max(0, a.earliestStart ?? 0))}`);
    });
    for (const v of this.vars) {
      const cap = Math.min(v.option.maxDaysSaved, input.network.activities[v.activity].duration);
      this.bounds.push(` 0 <= ${v.name} <= ${num(cap)}`);
    }
    this.bounds.push(" fin >= 0");
  }

  private costTerms(extra = 0): Term[] {
    return this.vars.map((v) => [v.option.costPerDayPkr + extra, v.name]);
  }

  /** CPLEX LP text for one solve. */
  toLp(spec: LpSpec): string {
    const objective: Term[] =
      spec.objective === "finish" ? [[1, "fin"]] : [...this.costTerms(this.tieBreak), [0, "fin"]];
    const rows = [...this.rows];
    if (spec.finishAtMost !== undefined) rows.push(row("target", [[1, "fin"]], "<=", spec.finishAtMost));
    if (spec.budgetPkr !== undefined && this.vars.length > 0) {
      rows.push(row("budget", this.costTerms(), "<=", spec.budgetPkr));
    }
    return [
      "Minimize",
      ` obj: ${expr(objective)}`,
      "Subject To",
      ...rows,
      "Bounds",
      ...this.bounds,
      "End",
      "",
    ].join("\n");
  }

  cost(values: Map<string, number>): number {
    return this.vars.reduce((sum, v) => sum + v.option.costPerDayPkr * (values.get(v.name) ?? 0), 0);
  }
}

function num(x: number): string {
  if (Object.is(x, -0)) return "0";
  return String(x);
}

/** Linear expression, a few terms per line to keep lines short. */
function expr(terms: Term[]): string {
  const parts = terms.map(([c, v], k) => {
    const sign = c < 0 ? "-" : "+";
    const text = `${sign} ${num(Math.abs(c))} ${v}`;
    return k > 0 && k % 8 === 0 ? `\n   ${text}` : text;
  });
  return parts.join(" ");
}

function row(name: string, terms: Term[], sense: "<=" | ">=", rhs: number): string {
  return ` ${name}: ${expr(terms)} ${sense} ${num(rhs)}`;
}

async function solve(lp: string, names: string[]): Promise<Solved> {
  let highs: Highs;
  try {
    highs = await getHighs();
  } catch (err) {
    return { kind: "error", message: `Could not load the solver: ${errorText(err)}` };
  }
  try {
    const res = highs.solve(lp, { output_flag: false });
    if (res.Status === "Optimal") {
      const values = new Map<string, number>();
      for (const name of names) {
        const col = res.Columns[name];
        values.set(name, col && "Primal" in col ? col.Primal : 0);
      }
      return { kind: "optimal", values };
    }
    if (res.Status === "Infeasible" || res.Status === "Primal infeasible or unbounded") {
      return { kind: "infeasible" };
    }
    return { kind: "error", message: `Solver stopped with status: ${res.Status}` };
  } catch (err) {
    return { kind: "error", message: `Solver failed: ${errorText(err)}` };
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function round(x: number, places: number): number {
  const f = 10 ** places;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function formatPkr(x: number): string {
  return `PKR ${Math.round(x).toLocaleString("en-US")}`;
}

function formatDays(x: number): string {
  const r = round(x, 2);
  return `${r} working day${r === 1 ? "" : "s"}`;
}

export async function optimiseRecovery(input: RecoveryInput): Promise<RecoveryResult> {
  const invalid = checkRecoveryInput(input);
  const empty = { meetsTarget: false, newFinish: NaN, totalCostPkr: 0, actions: [] };
  if (invalid) return { status: "error", originalFinish: NaN, ...empty, message: invalid };

  const { network, targetFinish, budgetPkr } = input;
  const originalFinish = round(computeCriticalPath(network).projectFinish, 9);

  if (originalFinish <= targetFinish + TIME_TOLERANCE) {
    return {
      status: "optimal",
      meetsTarget: true,
      originalFinish,
      newFinish: originalFinish,
      totalCostPkr: 0,
      actions: [],
      message: `Already on track: forecast finish ${formatDays(originalFinish)} is within the target of ${formatDays(targetFinish)}.`,
    };
  }

  const model = new CrashModel(input);
  const names = ["fin", ...model.vars.map((v) => v.name)];

  // Mode 1: cheapest way to meet the target, within the budget if given.
  const mode1 = await solve(model.toLp({ objective: "cost", finishAtMost: targetFinish, budgetPkr }), names);
  if (mode1.kind === "error") return { status: "error", originalFinish, ...empty, message: mode1.message };
  if (mode1.kind === "optimal") return finish(model, input, originalFinish, mode1.values);

  // Mode 2: the target can't be met. Fastest finish (within the budget), then
  // the cheapest way to get that finish.
  const fastest = await solve(model.toLp({ objective: "finish", budgetPkr }), names);
  if (fastest.kind === "error") return { status: "error", originalFinish, ...empty, message: fastest.message };
  if (fastest.kind === "infeasible") {
    return { status: "infeasible", originalFinish, ...empty, message: "The solver found no feasible schedule." };
  }
  // The fastest solution satisfies this LP, so it is feasible; if rounding
  // in the solver says otherwise, keep the fastest solution as it is.
  const best = fastest.values.get("fin")!;
  const cheapest = await solve(model.toLp({ objective: "cost", finishAtMost: best, budgetPkr }), names);
  const values = cheapest.kind === "optimal" ? cheapest.values : fastest.values;
  return finish(model, input, originalFinish, values);
}

/** Turns an LP solution into the result, checking it against the CPM engine. */
function finish(
  model: CrashModel,
  input: RecoveryInput,
  originalFinish: number,
  values: Map<string, number>,
): RecoveryResult {
  const { network, targetFinish, budgetPkr } = input;
  const lpFinish = values.get("fin")!;

  const saved = new Map<string, number>();
  for (const v of model.vars) {
    const x = values.get(v.name) ?? 0;
    const cap = Math.min(v.option.maxDaysSaved, network.activities[v.activity].duration);
    saved.set(v.name, x <= ZERO_DAYS ? 0 : Math.min(x, cap));
  }

  // Re-run the critical path with the crashed durations.
  const crashed: ScheduleNetwork = {
    activities: network.activities.map((a, i) => {
      const total = model.byActivity[i].reduce((sum, v) => sum + saved.get(v.name)!, 0);
      return { ...a, duration: Math.max(0, a.duration - total) };
    }),
    dependencies: network.dependencies,
  };
  const cpmFinish = computeCriticalPath(crashed).projectFinish;
  if (!(cpmFinish <= lpFinish + TIME_TOLERANCE * Math.max(1, Math.abs(lpFinish)))) {
    return {
      status: "error",
      meetsTarget: false,
      originalFinish,
      newFinish: NaN,
      totalCostPkr: 0,
      actions: [],
      message: `Internal check failed: the critical path gives ${cpmFinish} but the solver gave ${lpFinish}.`,
    };
  }
  const newFinish = round(cpmFinish, 6);
  const meetsTarget = newFinish <= targetFinish + TIME_TOLERANCE;

  const actions: RecoveryAction[] = [];
  for (const v of model.vars) {
    const x = saved.get(v.name)!;
    if (x <= 0) continue;
    actions.push({
      activityId: network.activities[v.activity].id,
      optionId: v.option.id,
      label: v.option.label,
      daysSaved: round(x, 2) > 0 ? round(x, 2) : round(x, 4),
      costPkr: Math.round(x * v.option.costPerDayPkr),
    });
  }
  actions.sort((a, b) => b.costPkr - a.costPkr || b.daysSaved - a.daysSaved);
  const totalCostPkr = Math.round(model.cost(saved));

  const daysBack = round(originalFinish - newFinish, 2);
  let message: string;
  if (meetsTarget) {
    message = `Target met: finish moves from ${formatDays(originalFinish)} to ${formatDays(newFinish)} for ${formatPkr(totalCostPkr)}.`;
  } else {
    const limit = budgetPkr !== undefined ? ` within the ${formatPkr(budgetPkr)} budget` : "";
    message =
      daysBack > 0
        ? `The target of ${formatDays(targetFinish)} can't be met${limit}. The fastest finish is ${formatDays(newFinish)} (${formatDays(daysBack)} earlier) for ${formatPkr(totalCostPkr)}.`
        : `The target of ${formatDays(targetFinish)} can't be met${limit}, and no available speed-up brings the finish forward from ${formatDays(originalFinish)}.`;
  }

  return { status: "optimal", meetsTarget, originalFinish, newFinish, totalCostPkr, actions, message };
}
