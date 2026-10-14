/**
 * Forecast a schedule file from the command line.
 *
 *   npm run forecast -- <file.xer|file.xml> [--target YYYY-MM-DD]
 *     [--data-date YYYY-MM-DD] [--iterations 2000] [--seed 1]
 *     [--project <P6 id or short name>] [--json]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { simulate } from "../lib/forecast/simulate";
import {
  SIX_DAY_WEEK,
  computeCriticalPath,
  finishOffsetToDate,
  importSchedule,
  startOffsetToDate,
} from "../lib/schedule";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: "string" },
    "data-date": { type: "string" },
    iterations: { type: "string", default: "2000" },
    seed: { type: "string" },
    project: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const file = positionals[0];
if (!file) {
  console.error("Usage: npm run forecast -- <file.xer|file.xml> [--target YYYY-MM-DD] [--data-date YYYY-MM-DD] [--iterations N] [--seed N] [--project ID] [--json]");
  process.exit(1);
}

const schedule = importSchedule(readFileSync(file, "utf8"), { project: values.project });
const dataDate = values["data-date"] ?? schedule.dataDate ?? new Date().toISOString().slice(0, 10);
const target = values.target ?? schedule.plannedFinish;
if (!target) {
  console.error("The file has no planned finish; pass --target YYYY-MM-DD.");
  process.exit(1);
}

const cpm = computeCriticalPath(schedule);
const forecast = simulate({
  network: schedule,
  dataDate,
  targetDate: target,
  iterations: Number(values.iterations),
  seed: values.seed === undefined ? undefined : Number(values.seed),
});

if (values.json) {
  console.log(JSON.stringify({ schedule: { ...schedule, activities: schedule.activities.length }, cpm, forecast }, null, 2));
  process.exit(0);
}

const byId = new Map(schedule.activities.map((a) => [a.id, a]));
const pct = (x: number) => `${Math.round(x * 100)}%`;

console.log(`\n${schedule.projectName}  (${schedule.source.toUpperCase()}, ${schedule.activities.length} activities, ${schedule.dependencies.length} links)`);
console.log(`Data date ${dataDate}   target finish ${target}`);
for (const w of schedule.warnings) console.log(`  ! ${w}`);

console.log(`\nCritical path (remaining work, six-day week):`);
for (const id of cpm.criticalPath) {
  const a = byId.get(id)!;
  const t = cpm.times[id];
  const finish = finishOffsetToDate(SIX_DAY_WEEK, dataDate, t.earlyFinish);
  // Zero-length activities (milestones, finished work) only have a date.
  const dates = a.duration > 0 ? `${startOffsetToDate(SIX_DAY_WEEK, dataDate, t.earlyStart)} → ${finish}` : finish;
  console.log(`  ${a.code.padEnd(10)} ${a.name.padEnd(28).slice(0, 28)} ${String(a.duration).padStart(5)} d  ${dates}`);
}

console.log(`\nForecast (${forecast.iterations} runs):`);
console.log(`  Chance of finishing after ${target}: ${pct(forecast.probabilityLate)}`);
console.log(`  Planned durations finish: ${forecast.deterministicFinish}`);
console.log(`  P10 ${forecast.p10}   P50 ${forecast.p50}   P90 ${forecast.p90}`);

const drivers = Object.entries(forecast.criticality)
  .filter(([, c]) => c > 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);
console.log(`\nActivities that drive the finish (share of runs on the critical path):`);
for (const [id, c] of drivers) {
  const a = byId.get(id)!;
  console.log(`  ${pct(c).padStart(4)}  ${a.code.padEnd(10)} ${a.name}`);
}
console.log();
