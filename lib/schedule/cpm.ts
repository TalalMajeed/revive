import type { LinkType, ScheduleNetwork } from "./types";

/**
 * Critical-path engine: forward and backward pass over an activity-on-node
 * network with FS, SS, FF and SF links and lags.
 *
 * Time is continuous working days from the data date (0). An activity that
 * starts at 0 with duration 5 finishes at 5. Activities never start before 0
 * or before their own earliestStart.
 */

export interface ActivityTimes {
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
}

export interface CriticalPathResult {
  projectFinish: number;
  times: Record<string, ActivityTimes>;
  /** Critical activity ids in topological order. */
  criticalPath: string[];
}

export interface CpmOptions {
  /**
   * Late dates are measured back from this finish instead of the computed
   * one. A target earlier than the computed finish gives negative float.
   */
  targetFinish?: number;
  /**
   * Activities whose float is within this of the lowest float in the network
   * are critical (the longest path). Default 1e-6.
   */
  criticalTolerance?: number;
}

const LINK_CODE: Record<LinkType, number> = { FS: 0, SS: 1, FF: 2, SF: 3 };

/**
 * The network in index form, built once and reused across many passes (the
 * simulation runs thousands). Links are stored in successor order so the
 * forward pass reads each activity's predecessors in one slice.
 */
export interface CompiledNetwork {
  ids: string[];
  indexOf: Map<string, number>;
  /** Activities in topological order. */
  order: Int32Array;
  durations: Float64Array;
  earliestStart: Float64Array;
  /** Incoming links of activity i are predStart[i] .. predStart[i + 1]. */
  predStart: Int32Array;
  predFrom: Int32Array;
  predType: Uint8Array;
  predLag: Float64Array;
}

export class ScheduleCycleError extends Error {
  constructor(public readonly activityIds: string[]) {
    super(`Schedule logic has a loop through: ${activityIds.join(", ")}`);
    this.name = "ScheduleCycleError";
  }
}

export function compileNetwork(network: ScheduleNetwork): CompiledNetwork {
  const n = network.activities.length;
  const ids = network.activities.map((a) => a.id);
  const indexOf = new Map<string, number>();
  ids.forEach((id, i) => {
    if (indexOf.has(id)) throw new Error(`Duplicate activity id: ${id}`);
    indexOf.set(id, i);
  });

  const durations = new Float64Array(n);
  const earliestStart = new Float64Array(n);
  network.activities.forEach((a, i) => {
    if (!(a.duration >= 0)) {
      throw new Error(`Activity ${a.id} has an invalid duration: ${a.duration}`);
    }
    durations[i] = a.duration;
    earliestStart[i] = Math.max(0, a.earliestStart ?? 0);
  });

  const links = network.dependencies.map((d) => {
    const from = indexOf.get(d.predecessorId);
    const to = indexOf.get(d.successorId);
    if (from === undefined) throw new Error(`Unknown predecessor: ${d.predecessorId}`);
    if (to === undefined) throw new Error(`Unknown successor: ${d.successorId}`);
    if (from === to) throw new Error(`Activity ${d.successorId} depends on itself`);
    return { from, to, type: LINK_CODE[d.type], lag: d.lag };
  });

  // Group links by successor (counting sort).
  const predStart = new Int32Array(n + 1);
  for (const l of links) predStart[l.to + 1]++;
  for (let i = 0; i < n; i++) predStart[i + 1] += predStart[i];
  const cursor = predStart.slice(0, n);
  const m = links.length;
  const predFrom = new Int32Array(m);
  const predType = new Uint8Array(m);
  const predLag = new Float64Array(m);
  for (const l of links) {
    const k = cursor[l.to]++;
    predFrom[k] = l.from;
    predType[k] = l.type;
    predLag[k] = l.lag;
  }

  // Kahn's algorithm, keeping input order among ready activities.
  const inDegree = new Int32Array(n);
  const succs: number[][] = Array.from({ length: n }, () => []);
  for (const l of links) {
    inDegree[l.to]++;
    succs[l.from].push(l.to);
  }
  const order = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) if (inDegree[i] === 0) order[tail++] = i;
  while (head < tail) {
    const i = order[head++];
    for (const j of succs[i]) if (--inDegree[j] === 0) order[tail++] = j;
  }
  if (tail < n) {
    throw new ScheduleCycleError(ids.filter((_, i) => inDegree[i] > 0));
  }

  return {
    ids,
    indexOf,
    order,
    durations,
    earliestStart,
    predStart,
    predFrom,
    predType,
    predLag,
  };
}

/**
 * Forward pass into `es`/`ef`. Returns the project finish (latest early
 * finish). `durations` defaults to the compiled ones; the simulation passes
 * sampled durations instead.
 */
export function forwardPass(
  net: CompiledNetwork,
  es: Float64Array,
  ef: Float64Array,
  durations: Float64Array = net.durations,
): number {
  const { order, earliestStart, predStart, predFrom, predType, predLag } = net;
  let finish = 0;
  for (let k = 0; k < order.length; k++) {
    const j = order[k];
    const dj = durations[j];
    let start = earliestStart[j];
    for (let p = predStart[j]; p < predStart[j + 1]; p++) {
      const i = predFrom[p];
      const lag = predLag[p];
      let s: number;
      switch (predType[p]) {
        case 0: // FS: successor starts after predecessor finishes
          s = ef[i] + lag;
          break;
        case 1: // SS: successor starts after predecessor starts
          s = es[i] + lag;
          break;
        case 2: // FF: successor finishes after predecessor finishes
          s = ef[i] + lag - dj;
          break;
        default: // SF: successor finishes after predecessor starts
          s = es[i] + lag - dj;
      }
      if (s > start) start = s;
    }
    es[j] = start;
    ef[j] = start + dj;
    if (ef[j] > finish) finish = ef[j];
  }
  return finish;
}

/** Backward pass into `ls`/`lf`, measured back from `projectFinish`. */
export function backwardPass(
  net: CompiledNetwork,
  projectFinish: number,
  ls: Float64Array,
  lf: Float64Array,
  durations: Float64Array = net.durations,
): void {
  const { order, predStart, predFrom, predType, predLag } = net;
  lf.fill(projectFinish);
  // Walk successors in reverse topological order and push constraints back
  // onto each predecessor. A successor's late dates are final once all
  // activities after it in the order have been visited.
  for (let k = order.length - 1; k >= 0; k--) {
    const j = order[k];
    ls[j] = lf[j] - durations[j];
    for (let p = predStart[j]; p < predStart[j + 1]; p++) {
      const i = predFrom[p];
      const lag = predLag[p];
      const di = durations[i];
      let f: number;
      switch (predType[p]) {
        case 0: // FS: LF(i) <= LS(j) - lag
          f = ls[j] - lag;
          break;
        case 1: // SS: LS(i) <= LS(j) - lag
          f = ls[j] - lag + di;
          break;
        case 2: // FF: LF(i) <= LF(j) - lag
          f = lf[j] - lag;
          break;
        default: // SF: LS(i) <= LF(j) - lag
          f = lf[j] - lag + di;
      }
      if (f < lf[i]) lf[i] = f;
    }
  }
}

export function computeCriticalPath(
  network: ScheduleNetwork,
  options: CpmOptions = {},
): CriticalPathResult {
  const net = compileNetwork(network);
  const n = net.ids.length;
  const tolerance = options.criticalTolerance ?? 1e-6;
  const es = new Float64Array(n);
  const ef = new Float64Array(n);
  const ls = new Float64Array(n);
  const lf = new Float64Array(n);

  const projectFinish = forwardPass(net, es, ef);
  backwardPass(net, options.targetFinish ?? projectFinish, ls, lf);

  // Free float: how far an activity can slip without delaying any successor.
  const freeFloat = new Float64Array(n).fill(Infinity);
  const { predStart, predFrom, predType, predLag } = net;
  const hasSuccessor = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    for (let p = predStart[j]; p < predStart[j + 1]; p++) {
      const i = predFrom[p];
      hasSuccessor[i] = 1;
      const lag = predLag[p];
      let slack: number;
      switch (predType[p]) {
        case 0:
          slack = es[j] - lag - ef[i];
          break;
        case 1:
          slack = es[j] - lag - es[i];
          break;
        case 2:
          slack = ef[j] - lag - ef[i];
          break;
        default:
          slack = ef[j] - lag - es[i];
      }
      if (slack < freeFloat[i]) freeFloat[i] = slack;
    }
  }

  let lowestFloat = Infinity;
  for (let i = 0; i < n; i++) lowestFloat = Math.min(lowestFloat, ls[i] - es[i]);

  const times: Record<string, ActivityTimes> = {};
  for (let i = 0; i < n; i++) {
    const totalFloat = ls[i] - es[i];
    const ff = hasSuccessor[i]
      ? freeFloat[i]
      : (options.targetFinish ?? projectFinish) - ef[i];
    times[net.ids[i]] = {
      earlyStart: es[i],
      earlyFinish: ef[i],
      lateStart: ls[i],
      lateFinish: lf[i],
      totalFloat: clean(totalFloat),
      freeFloat: clean(Math.min(ff, totalFloat)),
      critical: totalFloat - lowestFloat <= tolerance,
    };
  }

  const criticalPath = Array.from(net.order)
    .map((i) => net.ids[i])
    .filter((id) => times[id].critical);

  return { projectFinish, times, criticalPath };
}

/** Rounds away floating-point noise such as 2.9999999999999996. */
function clean(x: number): number {
  const r = Math.round(x * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}
