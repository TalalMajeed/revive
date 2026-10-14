import { describe, expect, it } from "vitest";
import { dailyRateFromContract, defaultCrashOptions, defaultOptionsForNetwork } from "./presets";

describe("defaultCrashOptions", () => {
  it("offers overtime then an extra crew, priced off the daily rate", () => {
    expect(defaultCrashOptions({ id: "A", duration: 20 }, 1000)).toEqual([
      { id: "overtime", label: "Overtime", maxDaysSaved: 3, costPerDayPkr: 1500 },
      { id: "extra-crew", label: "Extra crew", maxDaysSaved: 4, costPerDayPkr: 2500 },
    ]);
  });

  it("offers nothing for an activity with no work left", () => {
    expect(defaultCrashOptions({ id: "M", duration: 0 }, 1000)).toEqual([]);
  });

  it("skips finished activities across a network", () => {
    const options = defaultOptionsForNetwork(
      [
        { id: "A", duration: 10 },
        { id: "M", duration: 0 },
      ],
      100,
    );
    expect(Object.keys(options)).toEqual(["A"]);
  });
});

describe("dailyRateFromContract", () => {
  it("spreads the contract value over the working days", () => {
    expect(dailyRateFromContract(50_000_000, 250)).toBe(200_000);
  });

  it("returns 0 when there are no days or no value", () => {
    expect(dailyRateFromContract(50_000_000, 0)).toBe(0);
    expect(dailyRateFromContract(0, 250)).toBe(0);
    expect(dailyRateFromContract(Number.NaN, 250)).toBe(0);
  });
});
