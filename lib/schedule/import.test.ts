import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finishOffsetToDate, SIX_DAY_WEEK, startOffsetToDate } from "./calendar";
import { computeCriticalPath } from "./cpm";
import { durationToDays } from "./import-mspdi";
import { importSchedule } from "./index";
import type { ImportedSchedule } from "./types";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name), "utf8");

/**
 * Both fixtures describe the same small job, so both importers should
 * produce the same network:
 *   1000 Mobilisation (done) -FS-> 1010 Excavation (6 d left)
 *   1010 -SS +2-> 1020 Foundations (15 d) -FS-> 1030 Handover
 *   1010 -FF +1-> 1030
 */
function shape(s: ImportedSchedule) {
  const name = new Map(s.activities.map((a) => [a.id, a.name]));
  return {
    activities: s.activities.map((a) => [a.name, a.status, a.duration, a.isMilestone]),
    links: s.dependencies.map((d) => [name.get(d.predecessorId), name.get(d.successorId), d.type, d.lag]),
  };
}

const expected = {
  activities: [
    ["Mobilisation", "complete", 0, false],
    ["Excavation", "in_progress", 6, false],
    ["Foundations", "not_started", 15, false],
    ["Handover", "not_started", 0, true],
  ],
  links: [
    ["Mobilisation", "Excavation", "FS", 0],
    ["Excavation", "Foundations", "SS", 2],
    ["Foundations", "Handover", "FS", 0],
    ["Excavation", "Handover", "FF", 1],
  ],
};

describe("P6 XER import", () => {
  const s = importSchedule(fixture("sample.xer"));

  it("reads the project", () => {
    expect(s.source).toBe("xer");
    expect(s.projectName).toBe("REV-DEMO");
    expect(s.dataDate).toBe("2026-01-19");
    expect(s.plannedStart).toBe("2026-01-05");
  });

  it("reads activities and links in working days", () => {
    expect(shape(s)).toEqual(expected);
  });

  it("keeps P6 activity codes, WBS and progress", () => {
    const exc = s.activities.find((a) => a.code === "A1010")!;
    expect(exc).toMatchObject({
      id: "A1010",
      wbs: "CIV",
      originalDuration: 10,
      percentComplete: 40,
      actualStart: "2026-01-12",
      plannedFinish: "2026-01-23",
    });
  });

  it("skips level-of-effort activities and says so", () => {
    expect(s.activities.map((a) => a.code)).not.toContain("LOE1");
    expect(s.warnings.join(" ")).toMatch(/level-of-effort/);
    expect(s.warnings.join(" ")).toMatch(/Dropped 1 link/);
  });

  it("matches the early dates stored in the file", () => {
    // TASK.early_start_date / early_end_date in the fixture, worked by hand
    // the way P6 schedules. Checking against a real P6 export is still to do.
    const cpm = computeCriticalPath(s);
    const dates = (id: string) => [
      startOffsetToDate(SIX_DAY_WEEK, s.dataDate!, cpm.times[id].earlyStart),
      finishOffsetToDate(SIX_DAY_WEEK, s.dataDate!, cpm.times[id].earlyFinish),
    ];
    expect(dates("A1010")).toEqual(["2026-01-19", "2026-01-24"]);
    expect(dates("A1020")).toEqual(["2026-01-21", "2026-02-06"]);
    expect(cpm.criticalPath).toEqual(["A1000", "A1010", "A1020", "A1030"]);
  });

  it("picks a project by short name and rejects unknown ones", () => {
    expect(importSchedule(fixture("sample.xer"), { project: "REV-DEMO" }).activities).toHaveLength(4);
    expect(() => importSchedule(fixture("sample.xer"), { project: 999 })).toThrow(/not in the XER/);
  });
});

describe("MS Project XML import", () => {
  const s = importSchedule(fixture("sample.xml"));

  it("reads the project", () => {
    expect(s.source).toBe("mspdi");
    expect(s.projectName).toBe("Revive demo block");
    expect(s.dataDate).toBe("2026-01-19");
  });

  it("reads activities and links in working days", () => {
    expect(shape(s)).toEqual(expected);
  });

  it("skips summary tasks and drops their links with a warning", () => {
    expect(s.activities.map((a) => a.name)).not.toContain("Civil works");
    expect(s.warnings.join(" ")).toMatch(/Dropped 1 links to or from summary/);
  });

  it("parses MS Project durations", () => {
    expect(durationToDays("PT40H0M0S")).toBe(5);
    expect(durationToDays("PT4H30M0S")).toBe(0.563);
    expect(durationToDays("PT10H0M0S", 600)).toBe(1);
    expect(durationToDays("P2DT4H0M0S")).toBe(2.5);
    expect(durationToDays("garbage")).toBe(0);
  });
});

describe("importSchedule", () => {
  it("rejects files it doesn't recognise", () => {
    expect(() => importSchedule("name,duration\nA,3")).toThrow(/Unrecognised schedule file/);
  });
});
