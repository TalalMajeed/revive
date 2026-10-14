import { describe, expect, it } from "vitest";
import { awardFeatureLabel, awardFeatures, predictAwardRisk, type AwardSetup } from "./award";

const risky: AwardSetup = {
  project_type: "road",
  client_type: "provincial_government",
  funding_source: "adp",
  funding_secured_pct: 40,
  contract_value_pkr: 2.5e9,
  engineers_estimate_pkr: 3.125e9,
  bidders_count: 2,
  contract_start_date: "2026-01-01",
  original_completion_date: "2028-01-01",
  pec_category: "C2",
  design_status_at_award: "concept",
  province: "balochistan",
};

const safe: AwardSetup = {
  project_type: "building",
  client_type: "private",
  funding_source: "private",
  funding_secured_pct: 100,
  contract_value_pkr: 1.2e8,
  engineers_estimate_pkr: 1.2e8,
  bidders_count: 8,
  contract_start_date: "2026-03-01",
  original_completion_date: "2026-12-26",
  pec_category: "C4",
  design_status_at_award: "complete",
  province: "ict",
};

describe("awardFeatures", () => {
  it("derives bid_to_estimate and planned_duration_days", () => {
    const row = awardFeatures(risky);
    expect(row.bid_to_estimate).toBeCloseTo(0.8, 12);
    expect(row.planned_duration_days).toBe(730);
    expect(row.design_status_at_award).toBe("concept");
  });

  it("leaves unanswered or unusable answers missing", () => {
    const row = awardFeatures({
      contract_value_pkr: 1e9,
      engineers_estimate_pkr: null,
      contract_start_date: "2026-02-30",
      original_completion_date: "2027-01-01",
      funding_secured_pct: NaN,
    });
    expect(row.bid_to_estimate).toBeNull();
    expect(row.planned_duration_days).toBeNull();
    expect(row.funding_secured_pct).toBeNull();
    expect(row.project_type).toBeNull();
    expect(awardFeatures({ contract_start_date: "2027-01-01", original_completion_date: "2026-01-01" }).planned_duration_days).toBeNull();
  });

  it("normalises codes", () => {
    const row = awardFeatures({ province: " Punjab ", pec_category: "c3", project_type: "" });
    expect(row.province).toBe("punjab");
    expect(row.pec_category).toBe("C3");
    expect(row.project_type).toBeNull();
  });
});

describe("awardFeatureLabel", () => {
  it("writes plain English", () => {
    expect(awardFeatureLabel("funding_secured_pct", 40)).toBe("Funding secured: 40%");
    expect(awardFeatureLabel("design_status_at_award", "concept")).toBe("Design at award: concept only");
    expect(awardFeatureLabel("province", "kp")).toBe("Location: Khyber Pakhtunkhwa");
    expect(awardFeatureLabel("bid_to_estimate", 0.8)).toBe("Bid 20% below the engineer's estimate");
    expect(awardFeatureLabel("contract_value_pkr", 2.5e9)).toBe("Contract value: PKR 2.5 billion");
    expect(awardFeatureLabel("planned_duration_days", 730)).toBe("Planned duration: 730 days (about 24 months)");
    expect(awardFeatureLabel("bidders_count", null)).toBe("Bidders: not given");
    expect(awardFeatureLabel("project_type", "tunnel")).toBe("Project type: tunnel");
  });
});

describe("predictAwardRisk (demo model)", () => {
  it("matches Python's predict_proba", () => {
    // From training/make_award_demo_data.py's model, predict_proba in interpret 0.7.8.
    expect(predictAwardRisk(risky).probabilityLate).toBeCloseTo(0.8895208763110086, 9);
    expect(predictAwardRisk(safe).probabilityLate).toBeCloseTo(0.1638452143835789, 9);
  });

  it("returns up to five reasons, largest first, with directions", () => {
    const r = predictAwardRisk(risky);
    expect(r.isDemoModel).toBe(true);
    expect(r.reasons.length).toBe(5);
    const sizes = r.reasons.map((x) => Math.abs(x.score));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    for (const reason of r.reasons) {
      expect(reason.direction).toBe(reason.score > 0 ? "raises" : "lowers");
    }
    const labels = r.reasons.map((x) => x.label);
    expect(labels).toContain("Funding secured: 40%");
    expect(labels).toContain("Design at award: concept only");
    expect(r.reasons.find((x) => x.feature === "design_status_at_award")?.direction).toBe("raises");
  });

  it("works with nothing answered", () => {
    const r = predictAwardRisk({});
    expect(r.probabilityLate).toBeGreaterThan(0);
    expect(r.probabilityLate).toBeLessThan(1);
    for (const reason of r.reasons) expect(reason.label).toMatch(/not given$/);
  });
});
