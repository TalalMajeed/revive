import type { ProjectBundle } from "@/lib/data/types";
import { forecastWeek } from "@/lib/progress/forecast";
import { DEMO_SPECS } from "./projects";
import { buildDemoBundle } from "./site";

export const DEMO_IDS = DEMO_SPECS.map((s) => s.project.id);

/**
 * The demo projects with their weekly forecast log filled in, as if Revive
 * had run every Monday. `iterations` per week is lower than the live 2,000
 * so the demo loads quickly.
 */
export function buildDemoBundles(iterations = 1000): ProjectBundle[] {
  return DEMO_SPECS.map((spec) => {
    const bundle = buildDemoBundle(spec);
    const forecasts = bundle.updates.map((_, i) => forecastWeek(bundle, i, { iterations }).record);
    return { ...bundle, forecasts };
  });
}
