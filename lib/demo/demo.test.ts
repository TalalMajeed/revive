import { describe, expect, it } from "vitest";
import { forecastWeek } from "@/lib/progress/forecast";
import { baselineFinish } from "@/lib/progress/state";
import { CLINIC, ROAD, SCHOOL } from "./projects";
import { buildDemoBundle } from "./site";

describe("demo projects", () => {
  it("the school finishes late, months after the contract date", () => {
    const b = buildDemoBundle(SCHOOL);
    expect(b.project.status).toBe("completed");
    expect(b.project.actualCompletionDate! > SCHOOL.project.setup.original_completion_date!).toBe(true);
    expect(baselineFinish(b) <= SCHOOL.project.setup.original_completion_date!).toBe(true);
    // Every activity ends at 100%.
    const last = forecastWeek(b, undefined, { iterations: 200 });
    expect(last.status.actualPercent).toBeCloseTo(100);
  });

  it("the road is in progress and likely late; the clinic is on track", () => {
    const road = forecastWeek(buildDemoBundle(ROAD), undefined, { iterations: 500 });
    const clinic = forecastWeek(buildDemoBundle(CLINIC), undefined, { iterations: 500 });
    expect(road.status.dataDate).toBe("2026-10-12");
    expect(road.simulation.probabilityLate).toBeGreaterThan(0.8);
    expect(road.record.reasons.length).toBeGreaterThan(2);
    expect(clinic.simulation.probabilityLate).toBeLessThan(0.2);
    expect(clinic.record.healthScore).toBeGreaterThan(road.record.healthScore);
  });

  it("logs a weekly update for every Monday", () => {
    const b = buildDemoBundle(ROAD);
    expect(b.updates.length).toBeGreaterThan(25);
    expect(b.updates.every((u) => new Date(`${u.dataDate}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  });
});
