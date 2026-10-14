import {
  checkRecoveryInput,
  optimiseRecovery,
  type CrashOption,
  type RecoveryInput,
} from "@/lib/recovery/optimise";
import { dailyRateFromContract, defaultOptionsForNetwork } from "@/lib/recovery/presets";
import type { Activity, Dependency, LinkType, ScheduleNetwork } from "@/lib/schedule/types";

/**
 * POST /api/recovery: the cheapest way to bring a late schedule back to a
 * target finish.
 *
 * Body: { network, options?, targetFinish, budgetPkr?, contractValuePkr? }.
 * Times are working days from the data date. Without `options`, every
 * activity gets the default overtime and extra-crew options, priced from
 * contractValuePkr spread over the network's remaining working days.
 */

// HiGHS runs as WebAssembly under Node, the default runtime. (`export const
// runtime` is rejected when cacheComponents is on, so it is left implicit.)

const MAX_ACTIVITIES = 20_000;
const MAX_DEPENDENCIES = 100_000;
const LINK_TYPES: readonly LinkType[] = ["FS", "SS", "FF", "SF"];

class BadRequest extends Error {}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body must be JSON");
  }

  let input: RecoveryInput;
  try {
    input = parseInput(body);
  } catch (err) {
    if (err instanceof BadRequest) return badRequest(err.message);
    throw err;
  }
  const problem = checkRecoveryInput(input);
  if (problem) return badRequest(problem);

  const result = await optimiseRecovery(input);
  return Response.json(result, { status: result.status === "error" ? 500 : 200 });
}

function badRequest(message: string) {
  return Response.json({ status: "error", message }, { status: 400 });
}

function parseInput(body: unknown): RecoveryInput {
  const b = record(body, "Body");
  const network = parseNetwork(b.network);
  const targetFinish = number(b.targetFinish, "targetFinish");
  const budgetPkr = b.budgetPkr === undefined || b.budgetPkr === null ? undefined : number(b.budgetPkr, "budgetPkr");
  if (budgetPkr !== undefined && budgetPkr < 0) throw new BadRequest("budgetPkr can't be negative");

  let options: Record<string, CrashOption[]>;
  if (b.options === undefined || b.options === null) {
    const contractValuePkr = number(b.contractValuePkr, "contractValuePkr (needed when options are not given)");
    if (contractValuePkr <= 0) throw new BadRequest("contractValuePkr must be more than zero");
    const totalDays = network.activities.reduce((sum, a) => sum + a.duration, 0);
    options = defaultOptionsForNetwork(network.activities, dailyRateFromContract(contractValuePkr, totalDays));
  } else {
    options = parseOptions(b.options);
  }
  return { network, options, targetFinish, budgetPkr };
}

function parseNetwork(value: unknown): ScheduleNetwork {
  const n = record(value, "network");
  const acts = list(n.activities, "network.activities");
  const deps = n.dependencies === undefined ? [] : list(n.dependencies, "network.dependencies");
  if (acts.length === 0) throw new BadRequest("network.activities is empty");
  if (acts.length > MAX_ACTIVITIES) throw new BadRequest(`At most ${MAX_ACTIVITIES} activities`);
  if (deps.length > MAX_DEPENDENCIES) throw new BadRequest(`At most ${MAX_DEPENDENCIES} links`);

  const activities = acts.map((raw, i): Activity => {
    const a = record(raw, `network.activities[${i}]`);
    const id = text(a.id, `network.activities[${i}].id`);
    const duration = number(a.duration, `duration of ${id}`);
    if (duration < 0) throw new BadRequest(`duration of ${id} can't be negative`);
    const activity: Activity = { id, name: typeof a.name === "string" ? a.name : id, duration };
    if (a.earliestStart !== undefined && a.earliestStart !== null) {
      activity.earliestStart = number(a.earliestStart, `earliestStart of ${id}`);
    }
    return activity;
  });

  const dependencies = deps.map((raw, i): Dependency => {
    const d = record(raw, `network.dependencies[${i}]`);
    const type = d.type === undefined ? "FS" : d.type;
    if (!LINK_TYPES.includes(type as LinkType)) {
      throw new BadRequest(`network.dependencies[${i}].type must be one of ${LINK_TYPES.join(", ")}`);
    }
    return {
      predecessorId: text(d.predecessorId, `network.dependencies[${i}].predecessorId`),
      successorId: text(d.successorId, `network.dependencies[${i}].successorId`),
      type: type as LinkType,
      lag: d.lag === undefined ? 0 : number(d.lag, `network.dependencies[${i}].lag`),
    };
  });

  return { activities, dependencies };
}

function parseOptions(value: unknown): Record<string, CrashOption[]> {
  const o = record(value, "options");
  // No prototype, so an activity id such as "__proto__" is just a key.
  const out = Object.create(null) as Record<string, CrashOption[]>;
  for (const [activityId, raw] of Object.entries(o)) {
    out[activityId] = list(raw, `options for ${activityId}`).map((item, k) => {
      const c = record(item, `options for ${activityId}[${k}]`);
      const id = text(c.id, `options for ${activityId}[${k}].id`);
      return {
        id,
        label: typeof c.label === "string" && c.label !== "" ? c.label : id,
        maxDaysSaved: number(c.maxDaysSaved, `maxDaysSaved of ${activityId}/${id}`),
        costPerDayPkr: number(c.costPerDayPkr, `costPerDayPkr of ${activityId}/${id}`),
      };
    });
  }
  return out;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BadRequest(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new BadRequest(`${what} must be a list`);
  return value;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new BadRequest(`${what} must be a non-empty string`);
  return value;
}

function number(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new BadRequest(`${what} must be a number`);
  return value;
}
