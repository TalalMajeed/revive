import { describe, expect, it } from "vitest";
import { loadEbm, predict, termScores, type EbmRow, type EbmValue } from "./ebm";
import smallCls from "./__fixtures__/ebm-small.json";
import smallClsExpected from "./__fixtures__/ebm-small-expected.json";
import smallReg from "./__fixtures__/ebm-small-reg.json";
import smallRegExpected from "./__fixtures__/ebm-small-reg-expected.json";

// Fixtures come from training/make_ebm_fixture.py (interpret 0.7.8).

interface ExpectedFile {
  task: string;
  terms: string[];
  rows: Array<{
    input: Record<string, EbmValue | { float: string }>;
    score: number;
    value: number;
    contributions: Record<string, number>;
  }>;
}

const SPECIAL: Record<string, number> = { nan: NaN, "+inf": Infinity, "-inf": -Infinity };

function decodeRow(input: ExpectedFile["rows"][number]["input"]): EbmRow {
  const row: EbmRow = {};
  for (const [k, v] of Object.entries(input)) {
    row[k] = typeof v === "object" && v !== null ? SPECIAL[v.float] : v;
  }
  return row;
}

const TOL = 1e-9;

describe.each([
  ["classifier", smallCls, smallClsExpected as ExpectedFile],
  ["regressor", smallReg, smallRegExpected as ExpectedFile],
])("EBM %s matches Python", (_name, json, expected) => {
  const model = loadEbm(json);

  it("loads the expected task and terms", () => {
    expect(model.task).toBe(expected.task);
    expect(model.terms.map((t) => t.name)).toEqual(expected.terms);
    // The fixture includes pairs, which use the second binning level.
    expect(model.terms.some((t) => t.features.length === 2 && t.levelIndexes.every((l) => l === 1))).toBe(true);
  });

  it.each(expected.rows.map((r, i) => [i, r] as const))("row %i", (_i, r) => {
    const row = decodeRow(r.input);
    const p = predict(model, row);
    expect(Math.abs(p.score - r.score)).toBeLessThan(TOL);
    expect(Math.abs(p.value - r.value)).toBeLessThan(TOL);

    const scores = termScores(model, row);
    model.terms.forEach((t, i) => {
      expect(Math.abs(scores[i] - r.contributions[t.name])).toBeLessThan(TOL);
    });

    // Contributions are sorted by size and add up to the score.
    const sizes = p.contributions.map((c) => Math.abs(c.score));
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    const sum = p.intercept + p.contributions.reduce((a, c) => a + c.score, 0);
    expect(Math.abs(sum - p.score)).toBeLessThan(TOL);
  });
});

describe("EBM binning", () => {
  const model = loadEbm(smallCls);
  const lengthTerm = model.terms.findIndex((t) => t.name === "length_km");
  const lengthScore = (v: EbmValue) => termScores(model, { length_km: v })[lengthTerm];
  const lengthCuts = (() => {
    const f = model.features.find((f) => f.name === "length_km");
    if (f?.kind !== "continuous") throw new Error("fixture changed");
    return f.levels[0];
  })();

  it("puts a value on a cut in the bin above", () => {
    const scores = model.terms[lengthTerm].scores;
    // Bin k + 1 holds values from cut k - 1 (inclusive) up to cut k.
    expect(lengthScore(lengthCuts[2])).toBe(scores[3 + 1]);
    expect(lengthScore(lengthCuts[2] - 1e-9)).toBe(scores[3]);
    expect(lengthScore(lengthCuts[0] - 1)).toBe(scores[1]);
    expect(lengthScore(lengthCuts[lengthCuts.length - 1])).toBe(scores[lengthCuts.length + 1]);
  });

  it("treats null, undefined and NaN as missing, junk text as unknown", () => {
    const scores = model.terms[lengthTerm].scores;
    const s = lengthScore;
    expect(s(null)).toBe(scores[0]);
    expect(s(undefined)).toBe(scores[0]);
    expect(s(NaN)).toBe(scores[0]);
    expect(s("abc")).toBe(scores[scores.length - 1]);
    expect(s("")).toBe(scores[scores.length - 1]);
    expect(s(-Infinity)).toBe(scores[1]);
    expect(s(Infinity)).toBe(scores[scores.length - 2]);
    expect(s(" 4.5 ")).toBe(s(4.5));
  });

  it("puts unseen categories in the unknown bin", () => {
    const ti = model.terms.findIndex((t) => t.name === "soil");
    const scores = model.terms[ti].scores;
    expect(termScores(model, { soil: "volcanic" })[ti]).toBe(scores[scores.length - 1]);
    expect(termScores(model, { soil: null })[ti]).toBe(scores[0]);
  });
});

describe("loadEbm validation", () => {
  const clone = () => JSON.parse(JSON.stringify(smallCls));

  it("accepts the inner ebm object as well as the whole file", () => {
    expect(loadEbm(clone().ebm).terms.length).toBe(loadEbm(clone()).terms.length);
  });

  it("rejects multiclass models", () => {
    const j = clone();
    j.ebm.outputs[0].classes = [0, 1, 2];
    expect(() => loadEbm(j)).toThrow(/multiclass/);
  });

  it("rejects unsupported links", () => {
    const j = clone();
    j.ebm.outputs[0].link = "probit";
    expect(() => loadEbm(j)).toThrow(/probit/);
  });

  it("rejects score tables of the wrong shape", () => {
    const j = clone();
    j.ebm.terms[0].scores.pop();
    expect(() => loadEbm(j)).toThrow(/shape/);
  });

  it("rejects terms naming unknown features", () => {
    const j = clone();
    j.ebm.terms[0].term_features = ["nope"];
    expect(() => loadEbm(j)).toThrow(/unknown feature/);
  });

  it("rejects non-objects", () => {
    expect(() => loadEbm(null)).toThrow(/EBM JSON/);
    expect(() => loadEbm([])).toThrow(/EBM JSON/);
  });
});

describe("EBM hand-built model", () => {
  // Grouped categories (one bin shared by several), and a second binning
  // level used by the pair.
  const model = loadEbm({
    version: "1.0",
    ebm: {
      outputs: [{ task: "regression", link: "identity", link_param: "nan" }],
      intercept: [0.5],
      features: [
        { name: "f", type: "nominal", categories: [[["a", "b"], "c"], [["a", "b", "c"]]] },
        { name: "x", type: "continuous", cuts: [[1, 2], [1.5]] },
      ],
      terms: [
        { term_features: ["f"], scores: [10, 20, 30, 40] },
        { term_features: ["x"], scores: [0, 1, 2, 3, "nan"] },
        {
          term_features: ["f", "x"],
          scores: [
            [0, 1, 2, 3],
            [100, 101, 102, 103],
            [200, 201, 202, 203],
          ],
        },
      ],
    },
  });

  it("uses the first level for mains and the second for pairs", () => {
    expect(model.terms.map((t) => t.levelIndexes)).toEqual([[0], [0], [1, 1]]);
    expect(termScores(model, { f: "b", x: 1.7 })).toEqual([20, 2, 102]);
    expect(termScores(model, { f: "c", x: 2 })).toEqual([30, 3, 102]);
    expect(termScores(model, { f: "d", x: 1.5 })).toEqual([40, 2, 202]);
    expect(termScores(model, { f: null, x: 0 })).toEqual([10, 1, 1]);
  });

  it("names pair terms like interpret and sums in identity space", () => {
    const p = predict(model, { f: "a", x: 0.2 });
    expect(p.contributions.map((c) => c.term)).toEqual(["f & x", "f", "x"]);
    expect(p.score).toBe(0.5 + 20 + 1 + 101);
    expect(p.value).toBe(p.score);
  });
});
