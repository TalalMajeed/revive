import { describe, expect, it } from "vitest";
import { computeCriticalPath } from "../schedule/cpm";
import type { ScheduleNetwork } from "../schedule/types";
import { optimiseRecovery, type CrashOption, type RecoveryResult } from "./optimise";

const opt = (id: string, maxDaysSaved: number, costPerDayPkr: number): CrashOption => ({
  id,
  label: id,
  maxDaysSaved,
  costPerDayPkr,
});

/** Days saved and cost per activity/option, ignoring order. */
function plan(result: RecoveryResult): Record<string, [number, number]> {
  return Object.fromEntries(
    result.actions.map((a) => [`${a.activityId}/${a.optionId}`, [a.daysSaved, a.costPkr]]),
  );
}

/**
 * Two parallel paths:
 *
 *   A(10) -FS-> B(10)     finish 20 (critical)
 *   C(8)  -FS-> D(8)      finish 16
 *   E(1)                  a free speed-up that never helps
 *
 * Options: A 3 days @ 100, B 3 days @ 60, C 3 days @ 10, D 3 days @ 20,
 * E 1 day @ 0.
 */
const parallel: ScheduleNetwork = {
  activities: [
    { id: "A", name: "Excavate", duration: 10 },
    { id: "B", name: "Foundations", duration: 10 },
    { id: "C", name: "Procure steel", duration: 8 },
    { id: "D", name: "Fabricate", duration: 8 },
    { id: "E", name: "Survey", duration: 1 },
  ],
  dependencies: [
    { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
    { predecessorId: "C", successorId: "D", type: "FS", lag: 0 },
  ],
};
const parallelOptions = {
  A: [opt("ot", 3, 100)],
  B: [opt("ot", 3, 60)],
  C: [opt("ot", 3, 10)],
  D: [opt("ot", 3, 20)],
  E: [opt("free", 1, 0)],
};

describe("optimiseRecovery", () => {
  it("does nothing when the forecast already meets the target", async () => {
    const r = await optimiseRecovery({ network: parallel, options: parallelOptions, targetFinish: 20 });
    expect(r).toMatchObject({
      status: "optimal",
      meetsTarget: true,
      originalFinish: 20,
      newFinish: 20,
      totalCostPkr: 0,
      actions: [],
    });
  });

  it("crashes only the cheapest option on the critical path", async () => {
    // 20 -> 18: two days of B @ 60. The other path has 2 days of float left.
    const r = await optimiseRecovery({ network: parallel, options: parallelOptions, targetFinish: 18 });
    expect(r.status).toBe("optimal");
    expect(r.meetsTarget).toBe(true);
    expect(r.newFinish).toBeCloseTo(18, 6);
    expect(r.totalCostPkr).toBe(120);
    expect(plan(r)).toEqual({ "B/ot": [2, 120] });
  });

  it("crashes both paths when the target cuts into the second one", async () => {
    // 20 -> 15: B 3 days (180) then A 2 days (200); C-D 16 -> 15: C 1 day (10).
    const r = await optimiseRecovery({ network: parallel, options: parallelOptions, targetFinish: 15 });
    expect(r.meetsTarget).toBe(true);
    expect(r.newFinish).toBeCloseTo(15, 6);
    expect(r.totalCostPkr).toBe(390);
    expect(plan(r)).toEqual({ "A/ot": [2, 200], "B/ot": [3, 180], "C/ot": [1, 10] });
    // Most expensive first.
    expect(r.actions.map((a) => a.activityId)).toEqual(["A", "B", "C"]);
  });

  it("reports the fastest finish, at least cost, when the target can't be met", async () => {
    // A-B can only come down to 14. Getting there: A 3 (300) + B 3 (180);
    // C-D 16 -> 14: C 2 (20). Total 500.
    const r = await optimiseRecovery({ network: parallel, options: parallelOptions, targetFinish: 12 });
    expect(r.status).toBe("optimal");
    expect(r.meetsTarget).toBe(false);
    expect(r.originalFinish).toBe(20);
    expect(r.newFinish).toBeCloseTo(14, 6);
    expect(r.totalCostPkr).toBe(500);
    expect(plan(r)).toEqual({ "A/ot": [3, 300], "B/ot": [3, 180], "C/ot": [2, 20] });
    expect(r.message).toMatch(/can't be met/);
  });

  it("meets the target within a budget that is big enough", async () => {
    const r = await optimiseRecovery({
      network: parallel,
      options: parallelOptions,
      targetFinish: 15,
      budgetPkr: 390,
    });
    expect(r.meetsTarget).toBe(true);
    expect(r.totalCostPkr).toBe(390);
  });

  it("gets as close as the budget allows", async () => {
    // Target 15 needs 390. With 200: B 3 days (180) takes it to 17, then
    // 20 rupees of A @ 100 buys 0.2 days -> 16.8. C-D (16) isn't critical yet.
    const r = await optimiseRecovery({
      network: parallel,
      options: parallelOptions,
      targetFinish: 15,
      budgetPkr: 200,
    });
    expect(r.status).toBe("optimal");
    expect(r.meetsTarget).toBe(false);
    expect(r.newFinish).toBeCloseTo(16.8, 6);
    expect(r.totalCostPkr).toBe(200);
    expect(plan(r)).toEqual({ "B/ot": [3, 180], "A/ot": [0.2, 20] });
    expect(r.message).toMatch(/budget/);
  });

  it("does nothing with a zero budget", async () => {
    const r = await optimiseRecovery({
      network: parallel,
      options: parallelOptions,
      targetFinish: 15,
      budgetPkr: 0,
    });
    expect(r).toMatchObject({ status: "optimal", meetsTarget: false, newFinish: 20, totalCostPkr: 0, actions: [] });
  });

  it("uses the cheaper of two options on one activity first", async () => {
    const network: ScheduleNetwork = {
      activities: [{ id: "A", name: "Pour", duration: 10 }],
      dependencies: [],
    };
    const options = { A: [opt("overtime", 3, 100), opt("crew", 3, 50)] };
    const r1 = await optimiseRecovery({ network, options, targetFinish: 8.5 });
    expect(plan(r1)).toEqual({ "A/crew": [1.5, 75] });
    const r2 = await optimiseRecovery({ network, options, targetFinish: 5 });
    expect(plan(r2)).toEqual({ "A/crew": [3, 150], "A/overtime": [2, 200] });
  });

  it("never saves more days than an activity has left", async () => {
    const network: ScheduleNetwork = {
      activities: [{ id: "A", name: "Snag", duration: 2 }],
      dependencies: [],
    };
    const r = await optimiseRecovery({
      network,
      options: { A: [opt("cheap", 5, 10), opt("dear", 5, 20)] },
      targetFinish: 0,
    });
    expect(r.meetsTarget).toBe(true);
    expect(r.newFinish).toBeCloseTo(0, 6);
    expect(plan(r)).toEqual({ "A/cheap": [2, 20] });
  });

  it("respects an activity's earliest start", async () => {
    const network: ScheduleNetwork = {
      activities: [{ id: "A", name: "Roof", duration: 5, earliestStart: 3 }],
      dependencies: [],
    };
    const options = { A: [opt("ot", 4, 10)] };
    const r = await optimiseRecovery({ network, options, targetFinish: 6 });
    expect(r.originalFinish).toBe(8);
    expect(plan(r)).toEqual({ "A/ot": [2, 20] });
    const unreachable = await optimiseRecovery({ network, options, targetFinish: 2 });
    expect(unreachable.meetsTarget).toBe(false);
    expect(unreachable.newFinish).toBeCloseTo(4, 6);
  });

  describe("SS and FF links with lags", () => {
    /**
     * A(10) -SS +2-> B(6), A -FF +3-> B. B starts at max(2, 13 - 6) = 7 and
     * finishes at 13. B's finish is tied to A's, so crashing B (however
     * cheap) does nothing; crashing A pulls B's finish back day for day,
     * down to the SS limit of 2 + B's duration.
     */
    const network: ScheduleNetwork = {
      activities: [
        { id: "A", name: "Frame", duration: 10 },
        { id: "B", name: "Clad", duration: 6 },
      ],
      dependencies: [
        { predecessorId: "A", successorId: "B", type: "SS", lag: 2 },
        { predecessorId: "A", successorId: "B", type: "FF", lag: 3 },
      ],
    };
    const options = { A: [opt("ot", 4, 100)], B: [opt("ot", 2, 1)] };

    it("crashes the activity that drives the finish", async () => {
      expect(computeCriticalPath(network).projectFinish).toBe(13);
      const r = await optimiseRecovery({ network, options, targetFinish: 11 });
      expect(r.meetsTarget).toBe(true);
      expect(r.newFinish).toBeCloseTo(11, 6);
      expect(plan(r)).toEqual({ "A/ot": [2, 200] });
    });

    it("stops at the FF limit when the target is too tight", async () => {
      // A can lose 4 days at most: B finishes at 6 + 3 = 9 at the earliest.
      const r = await optimiseRecovery({ network, options, targetFinish: 7.5 });
      expect(r.meetsTarget).toBe(false);
      expect(r.newFinish).toBeCloseTo(9, 6);
      expect(plan(r)).toEqual({ "A/ot": [4, 400] });
    });

    it("crashes the successor when its own duration drives an SS chain", async () => {
      // A(4) -SS +2-> B(10), A -FF +1-> B: B runs 2-12. Only B's length
      // matters; A's cheaper option is useless.
      const ss: ScheduleNetwork = {
        activities: [
          { id: "A", name: "Set out", duration: 4 },
          { id: "B", name: "Blockwork", duration: 10 },
        ],
        dependencies: [
          { predecessorId: "A", successorId: "B", type: "SS", lag: 2 },
          { predecessorId: "A", successorId: "B", type: "FF", lag: 1 },
        ],
      };
      const r = await optimiseRecovery({
        network: ss,
        options: { A: [opt("ot", 2, 1)], B: [opt("ot", 4, 50)] },
        targetFinish: 9,
      });
      expect(r.originalFinish).toBe(12);
      expect(r.newFinish).toBeCloseTo(9, 6);
      expect(plan(r)).toEqual({ "B/ot": [3, 150] });
    });

    it("handles SF links and leads", async () => {
      // A(6) -SF +8-> B(3): B finishes at 8 at the earliest. B -FS -1-> C(4):
      // C runs 7-11. Crash A: no effect. Crash C 2 days: finish 9.
      const sf: ScheduleNetwork = {
        activities: [
          { id: "A", name: "A", duration: 6 },
          { id: "B", name: "B", duration: 3 },
          { id: "C", name: "C", duration: 4 },
        ],
        dependencies: [
          { predecessorId: "A", successorId: "B", type: "SF", lag: 8 },
          { predecessorId: "B", successorId: "C", type: "FS", lag: -1 },
        ],
      };
      const r = await optimiseRecovery({
        network: sf,
        options: { A: [opt("ot", 3, 1)], C: [opt("ot", 2, 30)] },
        targetFinish: 9,
      });
      expect(r.originalFinish).toBe(11);
      expect(r.newFinish).toBeCloseTo(9, 6);
      expect(plan(r)).toEqual({ "C/ot": [2, 60] });
    });
  });

  it("copes with activity ids that aren't safe LP names", async () => {
    const rename: Record<string, string> = {
      A: "A1010#7",
      B: "fin",
      C: "s0",
      D: "Pour slab: level 3 <= 5",
      E: "3f2b9c1e-6a7d-4c1b-9a4e-0d6c2f1b8e77",
    };
    const network: ScheduleNetwork = {
      activities: parallel.activities.map((a) => ({ ...a, id: rename[a.id] })),
      dependencies: parallel.dependencies.map((d) => ({
        ...d,
        predecessorId: rename[d.predecessorId],
        successorId: rename[d.successorId],
      })),
    };
    const options = Object.fromEntries(
      Object.entries(parallelOptions).map(([id, list]) => [rename[id], list]),
    );
    const r = await optimiseRecovery({ network, options, targetFinish: 15 });
    expect(r.totalCostPkr).toBe(390);
    expect(plan(r)).toEqual({
      "A1010#7/ot": [2, 200],
      "fin/ot": [3, 180],
      "s0/ot": [1, 10],
    });
  });

  it("returns an error for options on unknown activities and for loops", async () => {
    const unknown = await optimiseRecovery({
      network: parallel,
      options: { Z: [opt("ot", 1, 1)] },
      targetFinish: 15,
    });
    expect(unknown.status).toBe("error");
    expect(unknown.message).toMatch(/unknown activity: Z/);

    const loop = await optimiseRecovery({
      network: {
        activities: parallel.activities,
        dependencies: [...parallel.dependencies, { predecessorId: "B", successorId: "A", type: "FS", lag: 0 }],
      },
      options: {},
      targetFinish: 15,
    });
    expect(loop.status).toBe("error");
    expect(loop.message).toMatch(/loop/);
  });

  it("agrees with the critical path on random networks", async () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const types = ["FS", "SS", "FF", "SF"] as const;
    for (let trial = 0; trial < 25; trial++) {
      const n = 4 + Math.floor(rand() * 12);
      const activities = Array.from({ length: n }, (_, i) => ({
        id: `act ${i}`,
        name: `Activity ${i}`,
        duration: Math.floor(rand() * 15),
      }));
      const dependencies = [];
      for (let j = 1; j < n; j++) {
        for (let i = 0; i < j; i++) {
          if (rand() < 0.3) {
            dependencies.push({
              predecessorId: `act ${i}`,
              successorId: `act ${j}`,
              type: types[Math.floor(rand() * 4)],
              lag: Math.floor(rand() * 6) - 2,
            });
          }
        }
      }
      const network = { activities, dependencies };
      const options: Record<string, CrashOption[]> = {};
      for (const a of activities) {
        if (rand() < 0.7) {
          options[a.id] = [opt("ot", a.duration * 0.15, 10 + rand() * 90), opt("crew", a.duration * 0.2, 100 + rand() * 200)];
        }
      }
      const original = computeCriticalPath(network).projectFinish;
      const targetFinish = original * (0.6 + rand() * 0.4);
      const budgetPkr = rand() < 0.5 ? rand() * 2000 : undefined;
      const r = await optimiseRecovery({ network, options, targetFinish, budgetPkr });

      expect(r.status).toBe("optimal");
      if (budgetPkr !== undefined) expect(r.totalCostPkr).toBeLessThanOrEqual(Math.round(budgetPkr));
      if (r.meetsTarget) expect(r.newFinish).toBeLessThanOrEqual(targetFinish + 1e-6);
      expect(r.newFinish).toBeLessThanOrEqual(original + 1e-6);

      // Applying the reported (rounded) actions gives the reported finish.
      const saved = new Map<string, number>();
      for (const a of r.actions) saved.set(a.activityId, (saved.get(a.activityId) ?? 0) + a.daysSaved);
      for (const a of activities) {
        expect(saved.get(a.id) ?? 0).toBeLessThanOrEqual(a.duration + 1e-9);
      }
      const crashed = {
        activities: activities.map((a) => ({ ...a, duration: Math.max(0, a.duration - (saved.get(a.id) ?? 0)) })),
        dependencies,
      };
      expect(Math.abs(computeCriticalPath(crashed).projectFinish - r.newFinish)).toBeLessThan(0.05);
    }
  });
});
