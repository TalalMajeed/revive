import { describe, expect, it } from "vitest";
import { ScheduleCycleError, computeCriticalPath } from "./cpm";
import type { ScheduleNetwork } from "./types";

/**
 * Hand-made network using all four link types:
 *
 *   A(3) -FS 0-> B(4) -FS +2-> D(5) -FS-> F(0)
 *   A    -SS +1-> C(2) -FF +3-> E(6) -FS-> F
 *   A    -SF +4-> G(2) ------------FS-> F
 *
 * Worked by hand:
 *   A 0-3, B 3-7, C 1-3, D 9-14, E 0-6, G 2-4, F 14-14
 *   Critical path A, B, D, F; finish 14.
 */
const network: ScheduleNetwork = {
  activities: [
    { id: "A", name: "Mobilise", duration: 3 },
    { id: "B", name: "Excavate", duration: 4 },
    { id: "C", name: "Survey", duration: 2 },
    { id: "D", name: "Foundations", duration: 5 },
    { id: "E", name: "Procure steel", duration: 6 },
    { id: "G", name: "Permits", duration: 2 },
    { id: "F", name: "Handover", duration: 0 },
  ],
  dependencies: [
    { predecessorId: "A", successorId: "B", type: "FS", lag: 0 },
    { predecessorId: "A", successorId: "C", type: "SS", lag: 1 },
    { predecessorId: "A", successorId: "G", type: "SF", lag: 4 },
    { predecessorId: "B", successorId: "D", type: "FS", lag: 2 },
    { predecessorId: "C", successorId: "E", type: "FF", lag: 3 },
    { predecessorId: "D", successorId: "F", type: "FS", lag: 0 },
    { predecessorId: "E", successorId: "F", type: "FS", lag: 0 },
    { predecessorId: "G", successorId: "F", type: "FS", lag: 0 },
  ],
};

describe("computeCriticalPath", () => {
  const result = computeCriticalPath(network);
  const t = result.times;

  it("finds the project finish", () => {
    expect(result.projectFinish).toBe(14);
  });

  it("computes early dates for every link type", () => {
    expect([t.A.earlyStart, t.A.earlyFinish]).toEqual([0, 3]);
    expect([t.B.earlyStart, t.B.earlyFinish]).toEqual([3, 7]); // FS
    expect([t.C.earlyStart, t.C.earlyFinish]).toEqual([1, 3]); // SS +1
    expect([t.D.earlyStart, t.D.earlyFinish]).toEqual([9, 14]); // FS +2
    expect([t.E.earlyStart, t.E.earlyFinish]).toEqual([0, 6]); // FF +3
    expect([t.G.earlyStart, t.G.earlyFinish]).toEqual([2, 4]); // SF +4
    expect([t.F.earlyStart, t.F.earlyFinish]).toEqual([14, 14]);
  });

  it("computes late dates", () => {
    expect([t.A.lateStart, t.A.lateFinish]).toEqual([0, 3]);
    expect([t.B.lateStart, t.B.lateFinish]).toEqual([3, 7]);
    expect([t.C.lateStart, t.C.lateFinish]).toEqual([9, 11]);
    expect([t.D.lateStart, t.D.lateFinish]).toEqual([9, 14]);
    expect([t.E.lateStart, t.E.lateFinish]).toEqual([8, 14]);
    expect([t.G.lateStart, t.G.lateFinish]).toEqual([12, 14]);
  });

  it("computes total and free float", () => {
    const float = Object.fromEntries(
      Object.entries(t).map(([id, x]) => [id, [x.totalFloat, x.freeFloat]]),
    );
    expect(float).toEqual({
      A: [0, 0],
      B: [0, 0],
      C: [8, 0], // C can slip 8 days, but any slip moves E
      D: [0, 0],
      E: [8, 8],
      G: [10, 10],
      F: [0, 0],
    });
  });

  it("marks the critical path", () => {
    expect(result.criticalPath).toEqual(["A", "B", "D", "F"]);
  });

  it("gives negative float against an earlier target", () => {
    const late = computeCriticalPath(network, { targetFinish: 12 });
    expect(late.times.D.totalFloat).toBe(-2);
    expect(late.times.E.totalFloat).toBe(6);
    expect(late.criticalPath).toEqual(["A", "B", "D", "F"]);
  });

  it("does not depend on the order activities are listed in", () => {
    const shuffled = computeCriticalPath({
      activities: [...network.activities].reverse(),
      dependencies: [...network.dependencies].reverse(),
    });
    expect(shuffled.times).toEqual(result.times);
  });
});

describe("computeCriticalPath edge cases", () => {
  it("never starts an activity before the data date", () => {
    // FF with a long successor would put its start at -4.
    const r = computeCriticalPath({
      activities: [
        { id: "X", name: "x", duration: 1 },
        { id: "Y", name: "y", duration: 5 },
      ],
      dependencies: [{ predecessorId: "X", successorId: "Y", type: "FF", lag: 0 }],
    });
    expect(r.times.Y.earlyStart).toBe(0);
    expect(r.projectFinish).toBe(5);
  });

  it("handles leads (negative lag)", () => {
    const r = computeCriticalPath({
      activities: [
        { id: "X", name: "x", duration: 4 },
        { id: "Y", name: "y", duration: 2 },
      ],
      dependencies: [{ predecessorId: "X", successorId: "Y", type: "FS", lag: -1 }],
    });
    expect(r.times.Y.earlyStart).toBe(3);
    expect(r.projectFinish).toBe(5);
  });

  it("respects an activity's earliest start", () => {
    const r = computeCriticalPath({
      activities: [{ id: "X", name: "x", duration: 2, earliestStart: 3 }],
      dependencies: [],
    });
    expect(r.times.X.earlyStart).toBe(3);
    expect(r.projectFinish).toBe(5);
  });

  it("handles an empty network", () => {
    const r = computeCriticalPath({ activities: [], dependencies: [] });
    expect(r.projectFinish).toBe(0);
    expect(r.criticalPath).toEqual([]);
  });

  it("rejects loops in the logic", () => {
    const loop = () =>
      computeCriticalPath({
        activities: [
          { id: "X", name: "x", duration: 1 },
          { id: "Y", name: "y", duration: 1 },
          { id: "Z", name: "z", duration: 1 },
        ],
        dependencies: [
          { predecessorId: "X", successorId: "Y", type: "FS", lag: 0 },
          { predecessorId: "Y", successorId: "Z", type: "FS", lag: 0 },
          { predecessorId: "Z", successorId: "Y", type: "FS", lag: 0 },
        ],
      });
    expect(loop).toThrow(ScheduleCycleError);
    expect(loop).toThrow(/Y, Z/);
  });

  it("rejects links to unknown activities", () => {
    expect(() =>
      computeCriticalPath({
        activities: [{ id: "X", name: "x", duration: 1 }],
        dependencies: [{ predecessorId: "X", successorId: "nope", type: "FS", lag: 0 }],
      }),
    ).toThrow(/Unknown successor/);
  });
});
