import type { ForecastRecord, ProjectBundle } from "@/lib/data/types";
import { simulate, type SimulationResult, type TriangularRange } from "@/lib/forecast/simulate";
import { buildReasons } from "./reasons";
import { readSignals, type Signals } from "./signals";
import { calendarOf, remainingNetwork } from "./state";
import { weeklyStatus, type WeeklyStatus } from "./status";

/**
 * Day-one forecast: Monte Carlo on the remaining schedule, with each
 * activity's range widened by the warning signs in the weekly records.
 *
 * The widening rules are placeholders until they are fitted on finished
 * projects; the forecast is marked "learning" until then.
 */

export interface WeeklyForecast {
  status: WeeklyStatus;
  signals: Signals;
  simulation: SimulationResult;
  record: ForecastRecord;
}

export interface ForecastOptions {
  iterations?: number;
  seed?: number;
  keepFinishes?: boolean;
}

/** How far each remaining activity could stretch, given this week's signals. */
export function activityRanges(bundle: ProjectBundle, status: WeeklyStatus, signals: Signals) {
  const base = 1.3;
  const payment = 0.1 * Math.min(signals.paymentDelayDays / 30, 2);
  const design = 0.05 * Math.min(signals.openDesignIssues.length, 4);
  const pace = Math.min(Math.max((1 - status.spiT) * 0.8, 0), 0.4);
  const projectWide = base + payment + design + pace;

  const heldByDesign = new Set(signals.openDesignIssues.map((e) => e.activityId).filter(Boolean));
  const ranges: Record<string, TriangularRange> = {};
  for (const s of status.state.activities) {
    if (s.remaining <= 0) continue;
    const high = projectWide + (heldByDesign.has(s.activity.id) ? 0.3 : 0);
    ranges[s.activity.id] = { min: s.remaining * 0.9, mostLikely: s.remaining, max: s.remaining * high };
  }
  return { ranges, spread: { min: 0.9, max: projectWide } };
}

/**
 * 0–100, higher is healthier. Chance of delay carries half the weight; days
 * late, overdue payments and open design issues share the rest.
 */
export function healthScore(pLate: number, status: WeeklyStatus, signals: Signals): number {
  const daysLate = Math.max(status.daysLate, 0);
  const score =
    100 -
    50 * pLate -
    20 * Math.min(daysLate / 30, 1) -
    15 * Math.min(signals.paymentDelayDays / 60, 1) -
    15 * Math.min((signals.openDesignIssues.length + signals.openVariationOrders.length) / 4, 1);
  return Math.round(Math.min(100, Math.max(0, score)));
}

export function healthBand(score: number): "ok" | "warn" | "risk" {
  return score >= 70 ? "ok" : score >= 40 ? "warn" : "risk";
}

export function forecastWeek(
  bundle: ProjectBundle,
  updateIndex?: number,
  options: ForecastOptions = {},
): WeeklyForecast {
  const status = weeklyStatus(bundle, updateIndex);
  const signals = readSignals(bundle, status.dataDate);
  const { ranges } = activityRanges(bundle, status, signals);
  const update = bundle.updates.find((u) => u.dataDate === status.dataDate);

  let simulation = simulate({
    network: remainingNetwork(bundle, status.state),
    dataDate: status.dataDate,
    targetDate: status.targetDate,
    calendar: calendarOf(bundle),
    ranges,
    iterations: options.iterations ?? 2000,
    seed: options.seed ?? hash(`${bundle.project.id}:${status.dataDate}`),
    keepFinishes: options.keepFinishes,
  });

  // Nothing left to do: the finish is a fact, not a forecast.
  if (status.state.activities.every((s) => s.status === "complete")) {
    const finished = status.state.activities.reduce(
      (max, s) => (s.actualFinish && s.actualFinish > max ? s.actualFinish : max),
      bundle.project.scheduleStart,
    );
    simulation = {
      ...simulation,
      probabilityLate: finished > status.targetDate ? 1 : 0,
      deterministicFinish: finished,
      p10: finished,
      p50: finished,
      p90: finished,
    };
  }

  const health = healthScore(simulation.probabilityLate, status, signals);
  const record: ForecastRecord = {
    id: `${bundle.project.id}:${status.dataDate}`,
    updateId: update?.id,
    asOf: status.dataDate,
    method: "simulation",
    targetDate: status.targetDate,
    probabilityLate: simulation.probabilityLate,
    deterministicFinish: simulation.deterministicFinish,
    p10: simulation.p10,
    p50: simulation.p50,
    p90: simulation.p90,
    iterations: simulation.iterations,
    healthScore: health,
    reasons: buildReasons(bundle, status, signals),
    criticality: simulation.criticality,
    isLearning: true,
    createdAt: new Date().toISOString(),
  };

  return { status, signals, simulation, record };
}

/** Small stable string hash, so a week's forecast repeats exactly. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
