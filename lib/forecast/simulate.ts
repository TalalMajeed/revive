import {
  SIX_DAY_WEEK,
  backwardPass,
  compileNetwork,
  countWorkingDays,
  finishOffsetToDate,
  forwardPass,
  type ScheduleNetwork,
  type WorkCalendar,
} from "@/lib/schedule";

/**
 * Monte Carlo forecast on the remaining schedule. Each run draws every
 * remaining activity's duration from a triangular range and runs the
 * critical path; the spread of finish dates gives the chance of finishing
 * late and the P10/P50/P90 range.
 */

export interface TriangularRange {
  min: number;
  mostLikely: number;
  max: number;
}

export interface SimulateOptions {
  /** Remaining work: durations are the most likely remaining working days. */
  network: ScheduleNetwork;
  /** Offset 0 of the network: the date remaining work starts from. */
  dataDate: string;
  /** Finishing after this date counts as late. */
  targetDate: string;
  calendar?: WorkCalendar;
  /** Ranges for specific activities, in working days. */
  ranges?: Record<string, TriangularRange>;
  /**
   * Range for every other remaining activity, as multiples of its duration.
   * Default 0.9 to 1.3: a starting guess until it is calibrated on finished
   * projects.
   */
  defaultSpread?: { min: number; max: number };
  /** Default 2,000. */
  iterations?: number;
  /** Fixes the random draws, for tests and for reproducing a logged forecast. */
  seed?: number;
}

export interface SimulationResult {
  iterations: number;
  /** Share of runs finishing after the target date. */
  probabilityLate: number;
  /** Finish with every activity at its most likely duration. */
  deterministicFinish: string;
  p10: string;
  p50: string;
  p90: string;
  /** The same percentiles in working days from the data date. */
  finishDays: { deterministic: number; p10: number; p50: number; p90: number };
  /** Activity id -> share of runs in which it was on the critical path. */
  criticality: Record<string, number>;
}

export const DEFAULT_SPREAD = { min: 0.9, max: 1.3 } as const;

export function simulate(options: SimulateOptions): SimulationResult {
  const calendar = options.calendar ?? SIX_DAY_WEEK;
  const iterations = options.iterations ?? 2000;
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(`iterations must be a positive integer, got ${iterations}`);
  }
  const spread = options.defaultSpread ?? DEFAULT_SPREAD;
  if (!(spread.min >= 0 && spread.min <= 1 && spread.max >= 1)) {
    throw new Error("defaultSpread needs 0 <= min <= 1 <= max");
  }

  const net = compileNetwork(options.network);
  const n = net.ids.length;

  // Range per activity. Activities with nothing left (complete, milestones)
  // stay at zero unless given an explicit range.
  const lo = new Float64Array(n);
  const mode = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = options.ranges?.[net.ids[i]];
    const d = net.durations[i];
    if (r) {
      if (!(r.min >= 0 && r.min <= r.mostLikely && r.mostLikely <= r.max)) {
        throw new Error(`Activity ${net.ids[i]} needs 0 <= min <= mostLikely <= max`);
      }
      lo[i] = r.min;
      mode[i] = r.mostLikely;
      hi[i] = r.max;
    } else {
      lo[i] = d * spread.min;
      mode[i] = d;
      hi[i] = d * spread.max;
    }
  }

  const es = new Float64Array(n);
  const ef = new Float64Array(n);
  const ls = new Float64Array(n);
  const lf = new Float64Array(n);

  const deterministic = forwardPass(net, es, ef, mode);

  const random = mulberry32(options.seed ?? (Math.random() * 2 ** 32) >>> 0);
  const sampled = new Float64Array(n);
  const finishes = new Float64Array(iterations);
  const criticalCount = new Uint32Array(n);
  const targetDays = countWorkingDays(calendar, options.dataDate, options.targetDate);
  let late = 0;

  for (let k = 0; k < iterations; k++) {
    for (let i = 0; i < n; i++) sampled[i] = triangular(lo[i], mode[i], hi[i], random());
    const finish = forwardPass(net, es, ef, sampled);
    finishes[k] = finish;
    // Work fills whole days, so a finish of 10.2 lands on the 11th working day.
    if (Math.ceil(finish - 1e-9) > targetDays) late++;

    backwardPass(net, finish, ls, lf, sampled);
    for (let i = 0; i < n; i++) if (ls[i] - es[i] <= 1e-6) criticalCount[i]++;
  }

  finishes.sort();
  const pct = (p: number) => finishes[Math.max(0, Math.ceil(p * iterations) - 1)];
  const p10 = pct(0.1);
  const p50 = pct(0.5);
  const p90 = pct(0.9);
  const toDate = (days: number) => finishOffsetToDate(calendar, options.dataDate, days);

  const criticality: Record<string, number> = {};
  for (let i = 0; i < n; i++) criticality[net.ids[i]] = criticalCount[i] / iterations;

  return {
    iterations,
    probabilityLate: late / iterations,
    deterministicFinish: toDate(deterministic),
    p10: toDate(p10),
    p50: toDate(p50),
    p90: toDate(p90),
    finishDays: { deterministic, p10, p50, p90 },
    criticality,
  };
}

/** Inverse-CDF draw from a triangular distribution, given u in [0, 1). */
export function triangular(min: number, mode: number, max: number, u: number): number {
  const width = max - min;
  if (width <= 0) return mode;
  const split = (mode - min) / width;
  return u < split
    ? min + Math.sqrt(u * width * (mode - min))
    : max - Math.sqrt((1 - u) * width * (max - mode));
}

/** Small seeded PRNG; returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
