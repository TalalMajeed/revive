import { describe, expect, it } from "vitest";
import type { ScheduleNetwork } from "@/lib/schedule";
import { mulberry32, simulate, triangular } from "./simulate";

// Data date Monday 2026-01-19, six-day week.
const DATA_DATE = "2026-01-19";

const chain: ScheduleNetwork = {
  activities: [
    { id: "A", name: "Excavation", duration: 6 },
    { id: "B", name: "Foundations", duration: 12 },
  ],
  dependencies: [{ predecessorId: "A", successorId: "B", type: "FS", lag: 0 }],
};

describe("simulate", () => {
  it("matches the critical path when there is no spread", () => {
    const r = simulate({
      network: chain,
      dataDate: DATA_DATE,
      targetDate: "2026-02-07", // the 18th working day
      defaultSpread: { min: 1, max: 1 },
      iterations: 50,
      seed: 1,
    });
    expect(r.finishDays).toEqual({ deterministic: 18, p10: 18, p50: 18, p90: 18 });
    expect([r.deterministicFinish, r.p10, r.p50, r.p90]).toEqual(Array(4).fill("2026-02-07"));
    expect(r.probabilityLate).toBe(0);
    expect(r.criticality).toEqual({ A: 1, B: 1 });

    const oneDayEarlier = simulate({
      network: chain,
      dataDate: DATA_DATE,
      targetDate: "2026-02-06",
      defaultSpread: { min: 1, max: 1 },
      iterations: 50,
      seed: 1,
    });
    expect(oneDayEarlier.probabilityLate).toBe(1);
  });

  it("matches the triangular distribution for a single activity", () => {
    // Triangular(10, 10, 20): P(X > 15) = 5² / (10 · 10) = 0.25,
    // median = 20 - sqrt(50) = 12.93, so the 13th working day.
    const r = simulate({
      network: { activities: [{ id: "A", name: "a", duration: 10 }], dependencies: [] },
      ranges: { A: { min: 10, mostLikely: 10, max: 20 } },
      dataDate: DATA_DATE,
      targetDate: "2026-02-04", // the 15th working day
      iterations: 20_000,
      seed: 42,
    });
    expect(r.probabilityLate).toBeCloseTo(0.25, 1);
    expect(Math.abs(r.probabilityLate - 0.25)).toBeLessThan(0.015);
    expect(r.finishDays.p50).toBeCloseTo(12.93, 0);
    expect(r.p50).toBe("2026-02-02"); // 13th working day
    expect(r.deterministicFinish).toBe("2026-01-29"); // 10th working day
  });

  it("finishes later than the plan when parallel paths merge", () => {
    // Two equal parallel paths: the finish is the later of the two, so its
    // median sits above either path's own median.
    const r = simulate({
      network: {
        activities: [
          { id: "A", name: "a", duration: 10 },
          { id: "B", name: "b", duration: 10 },
        ],
        dependencies: [],
      },
      ranges: {
        A: { min: 8, mostLikely: 10, max: 12 },
        B: { min: 8, mostLikely: 10, max: 12 },
      },
      dataDate: DATA_DATE,
      targetDate: "2026-01-29", // 10th working day
      iterations: 5000,
      seed: 7,
    });
    expect(r.finishDays.p50).toBeGreaterThan(10.3);
    // P(max(A, B) <= 10) = 0.5 · 0.5
    expect(r.probabilityLate).toBeCloseTo(0.75, 1);
    expect(r.criticality.A).toBeCloseTo(0.5, 1);
    expect(r.criticality.B).toBeCloseTo(0.5, 1);
  });

  it("finds which activities drive the finish", () => {
    const r = simulate({
      network: {
        activities: [
          { id: "long", name: "long", duration: 20 },
          { id: "short", name: "short", duration: 5 },
        ],
        dependencies: [],
      },
      dataDate: DATA_DATE,
      targetDate: "2026-03-31",
      iterations: 500,
      seed: 3,
    });
    expect(r.criticality.long).toBe(1);
    expect(r.criticality.short).toBe(0);
    expect(r.probabilityLate).toBe(0);
  });

  it("keeps finished work at zero and orders the percentiles", () => {
    const r = simulate({
      network: {
        activities: [
          { id: "done", name: "done", duration: 0 },
          ...chain.activities,
        ],
        dependencies: [
          { predecessorId: "done", successorId: "A", type: "FS", lag: 0 },
          ...chain.dependencies,
        ],
      },
      dataDate: DATA_DATE,
      targetDate: "2026-02-07",
      iterations: 2000,
      seed: 11,
    });
    expect(r.finishDays.p10).toBeLessThanOrEqual(r.finishDays.p50);
    expect(r.finishDays.p50).toBeLessThanOrEqual(r.finishDays.p90);
    expect(r.p10 <= r.p50 && r.p50 <= r.p90).toBe(true);
    // Default spread 0.9-1.3 around 18 days.
    expect(r.finishDays.p10).toBeGreaterThan(16.2);
    expect(r.finishDays.p90).toBeLessThan(23.4);
    expect(r.probabilityLate).toBeGreaterThan(0.5);
  });

  it("gives the same answer for the same seed", () => {
    const run = (seed: number) =>
      simulate({ network: chain, dataDate: DATA_DATE, targetDate: "2026-02-07", iterations: 300, seed });
    expect(run(5)).toEqual(run(5));
    expect(run(5).finishDays.p50).not.toBe(run(6).finishDays.p50);
  });

  it("runs 2,000 iterations of a 300-activity schedule quickly", () => {
    const n = 300;
    const network: ScheduleNetwork = {
      activities: Array.from({ length: n }, (_, i) => ({ id: `A${i}`, name: `A${i}`, duration: 1 + (i % 7) })),
      dependencies: Array.from({ length: n - 1 }, (_, i) => ({
        predecessorId: `A${Math.floor(i / 2)}`,
        successorId: `A${i + 1}`,
        type: "FS" as const,
        lag: 0,
      })),
    };
    const started = performance.now();
    const r = simulate({ network, dataDate: DATA_DATE, targetDate: "2026-12-31", seed: 1 });
    expect(r.iterations).toBe(2000);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("rejects bad ranges", () => {
    expect(() =>
      simulate({
        network: chain,
        ranges: { A: { min: 5, mostLikely: 4, max: 8 } },
        dataDate: DATA_DATE,
        targetDate: "2026-02-07",
      }),
    ).toThrow(/min <= mostLikely <= max/);
    expect(() =>
      simulate({ network: chain, dataDate: DATA_DATE, targetDate: "2026-02-07", iterations: 0 }),
    ).toThrow(/iterations/);
  });
});

describe("triangular", () => {
  it("hits the ends and the mode", () => {
    expect(triangular(2, 5, 10, 0)).toBe(2);
    expect(triangular(2, 5, 10, 0.375)).toBeCloseTo(5); // split = (5 - 2) / 8
    expect(triangular(2, 5, 10, 1)).toBe(10);
    expect(triangular(4, 4, 4, 0.7)).toBe(4);
  });

  it("has the right mean", () => {
    const random = mulberry32(99);
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) sum += triangular(2, 5, 11, random());
    expect(sum / n).toBeCloseTo((2 + 5 + 11) / 3, 1);
  });
});
