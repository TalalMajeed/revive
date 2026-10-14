import { describe, expect, it } from "vitest";
import {
  SIX_DAY_WEEK,
  countWorkingDays,
  finishOffsetToDate,
  isWorkingDay,
  startOffsetToDate,
  workingDayAt,
} from "./calendar";

// 2026-01-19 is a Monday; 2026-01-25 is a Sunday.
describe("calendar", () => {
  it("skips Sundays on a six-day week", () => {
    expect(isWorkingDay(SIX_DAY_WEEK, "2026-01-24")).toBe(true);
    expect(isWorkingDay(SIX_DAY_WEEK, "2026-01-25")).toBe(false);
    expect(workingDayAt(SIX_DAY_WEEK, "2026-01-19", 5)).toBe("2026-01-24");
    expect(workingDayAt(SIX_DAY_WEEK, "2026-01-19", 6)).toBe("2026-01-26");
    expect(workingDayAt(SIX_DAY_WEEK, "2026-01-25", 0)).toBe("2026-01-26");
  });

  it("skips holidays", () => {
    const cal = { workingWeekdays: [1, 2, 3, 4, 5, 6], holidays: ["2026-02-05"] }; // Kashmir Day
    expect(workingDayAt(cal, "2026-02-04", 1)).toBe("2026-02-06");
    expect(countWorkingDays(cal, "2026-02-02", "2026-02-07")).toBe(5);
  });

  it("counts working days inclusively", () => {
    expect(countWorkingDays(SIX_DAY_WEEK, "2026-01-19", "2026-01-24")).toBe(6);
    expect(countWorkingDays(SIX_DAY_WEEK, "2026-01-19", "2026-01-26")).toBe(7);
    expect(countWorkingDays(SIX_DAY_WEEK, "2026-01-19", "2026-01-18")).toBe(0);
  });

  it("turns offsets into dates", () => {
    expect(startOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 0)).toBe("2026-01-19");
    expect(startOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 2)).toBe("2026-01-21");
    expect(finishOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 1)).toBe("2026-01-19");
    expect(finishOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 6)).toBe("2026-01-24");
    expect(finishOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 6.2)).toBe("2026-01-26");
    expect(finishOffsetToDate(SIX_DAY_WEEK, "2026-01-19", 0)).toBe("2026-01-19");
  });

  it("rejects a calendar with no working days", () => {
    expect(() => workingDayAt({ workingWeekdays: [] }, "2026-01-19", 0)).toThrow();
  });
});
