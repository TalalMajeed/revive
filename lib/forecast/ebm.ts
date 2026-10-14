/**
 * Evaluates an Explainable Boosting Machine exported from Python with
 * interpret's `to_json()` (tested against interpret 0.7.8, any `detail`
 * level; only the fields `minimal` writes are read).
 *
 * An EBM's prediction is an intercept plus one score per term, each looked
 * up in a table by the bins the row's values fall into. Those per-term
 * scores are the exact reasons for the prediction, so `predict` returns them
 * alongside the total.
 *
 * Binning matches interpret's `eval_terms`:
 * - Every term's table has a bin 0 for a missing value and a last bin for a
 *   value it can't place (an unseen category, or text that isn't a number in
 *   a continuous feature).
 * - Continuous: with cuts c[0] < ... < c[n-1], the bin is 1 + the number of
 *   cuts <= x, so a value exactly on a cut goes to the bin above it (cuts are
 *   inclusive lower bounds). Below every cut is bin 1, at or above the last
 *   cut is bin n + 1, and -Infinity and +Infinity land in those two. null,
 *   undefined and NaN are missing (bin 0). Text is read like Python's
 *   float() ("12.5", " 1e3 ", "inf", "nan" is missing); other text,
 *   including "", is unknown.
 * - Nominal and ordinal: null, undefined and NaN are missing; any other value
 *   is looked up as text (numbers as interpret writes them, so 3 is "3"),
 *   and text not seen in training, including "", is unknown.
 * - A feature can carry several binning levels: main effects use the first,
 *   pairs the second (when there is one), and so on.
 */

export type EbmValue = number | string | null | undefined;
export type EbmRow = Record<string, EbmValue>;

export type EbmTask = "classification" | "regression";

interface ContinuousFeature {
  kind: "continuous";
  name: string;
  /** One array of ascending cuts per binning level. */
  levels: number[][];
}

interface CategoricalFeature {
  kind: "nominal" | "ordinal";
  name: string;
  /** Per binning level: category text to bin index (1-based). */
  levels: Map<string, number>[];
  /** Per binning level: the highest bin index used by a category. */
  maxBin: number[];
}

export type EbmFeature = ContinuousFeature | CategoricalFeature;

export interface EbmTerm {
  /** interpret's term name: feature names joined with " & ". */
  name: string;
  features: string[];
  featureIndexes: number[];
  /** Which binning level of each feature this term uses. */
  levelIndexes: number[];
  shape: number[];
  /** Scores flattened in row-major (C) order. */
  scores: Float64Array;
}

export interface EbmModel {
  task: EbmTask;
  link: "logit" | "identity";
  /** Class labels for classification, in interpret's order ([negative, positive]). */
  classes?: unknown[];
  intercept: number;
  features: EbmFeature[];
  terms: EbmTerm[];
}

export interface EbmContribution {
  term: string;
  features: string[];
  score: number;
}

export interface EbmPrediction {
  /** Intercept plus every term's score, in link space (log-odds for logit). */
  score: number;
  /** Probability of the positive class for classification, the prediction for regression. */
  value: number;
  intercept: number;
  /** One entry per term, largest |score| first. */
  contributions: EbmContribution[];
}

class EbmFormatError extends Error {
  constructor(message: string) {
    super(`EBM JSON: ${message}`);
    this.name = "EbmFormatError";
  }
}

function fail(message: string): never {
  throw new EbmFormatError(message);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** interpret writes NaN and infinities as "nan", "+inf" and "-inf". */
function jsonNumber(v: unknown, where: string): number {
  if (typeof v === "number") return v;
  if (v === "nan") return NaN;
  if (v === "+inf") return Infinity;
  if (v === "-inf") return -Infinity;
  return fail(`${where} should be a number, got ${JSON.stringify(v)}`);
}

function parseFeature(raw: unknown, i: number): EbmFeature {
  if (!isObject(raw)) fail(`features[${i}] is not an object`);
  const name = raw.name;
  if (typeof name !== "string") fail(`features[${i}].name is missing`);
  const type = raw.type;

  if (type === "continuous") {
    const cuts = raw.cuts;
    if (!Array.isArray(cuts) || cuts.length === 0) fail(`feature "${name}" has no cuts`);
    const levels = cuts.map((level, li) => {
      if (!Array.isArray(level)) fail(`feature "${name}" cuts[${li}] is not an array`);
      const values = level.map((c, ci) => {
        if (typeof c !== "number" || !Number.isFinite(c)) {
          fail(`feature "${name}" cut ${ci} at level ${li} is not a finite number`);
        }
        return c;
      });
      for (let k = 1; k < values.length; k++) {
        if (!(values[k] > values[k - 1])) fail(`feature "${name}" cuts at level ${li} are not ascending`);
      }
      return values;
    });
    return { kind: "continuous", name, levels };
  }

  if (type === "nominal" || type === "ordinal") {
    const categories = raw.categories;
    if (!Array.isArray(categories) || categories.length === 0) {
      fail(`feature "${name}" has no categories`);
    }
    const levels: Map<string, number>[] = [];
    const maxBin: number[] = [];
    categories.forEach((level, li) => {
      if (!Array.isArray(level)) fail(`feature "${name}" categories[${li}] is not an array`);
      // Entry k (0-based) is bin k + 1; an entry that is itself an array is a
      // group of categories sharing one bin.
      const map = new Map<string, number>();
      level.forEach((entry, k) => {
        const group = Array.isArray(entry) ? entry : [entry];
        for (const category of group) {
          if (typeof category !== "string") {
            fail(`feature "${name}" category ${JSON.stringify(category)} is not text`);
          }
          map.set(category, k + 1);
        }
      });
      levels.push(map);
      maxBin.push(level.length);
    });
    return { kind: type, name, levels, maxBin };
  }

  return fail(`feature "${name}" has unsupported type ${JSON.stringify(type)}`);
}

/** Number of bins in a feature's table at one level: missing + regular + unknown. */
function binCount(feature: EbmFeature, level: number): number {
  if (feature.kind === "continuous") return feature.levels[level].length + 3;
  return feature.maxBin[level] + 2;
}

function flattenScores(raw: unknown, shape: number[], where: string): Float64Array {
  const out = new Float64Array(shape.reduce((a, b) => a * b, 1));
  let pos = 0;
  const walk = (node: unknown, dim: number) => {
    if (!Array.isArray(node) || node.length !== shape[dim]) {
      fail(`${where} scores should have shape [${shape.join(", ")}]`);
    }
    if (dim === shape.length - 1) {
      for (const v of node) out[pos++] = jsonNumber(v, `${where} score`);
    } else {
      for (const child of node) walk(child, dim + 1);
    }
  };
  walk(raw, 0);
  return out;
}

/**
 * Validates an interpret `to_json()` export and prepares it for `predict`.
 * Accepts the whole file (`{ version, ebm }`) or just its `ebm` object.
 * Throws on anything it can't evaluate exactly: multiclass, multiple
 * outputs, or links other than logit (binary) and identity (regression).
 */
export function loadEbm(json: unknown): EbmModel {
  if (!isObject(json)) fail("expected an object");
  const inner = "ebm" in json ? json.ebm : json;
  if (!isObject(inner)) fail(`"ebm" is not an object`);
  if ("version" in json && json.version !== "1.0") {
    fail(`unsupported format version ${JSON.stringify(json.version)} (expected "1.0")`);
  }

  const outputs = inner.outputs;
  if (!Array.isArray(outputs) || outputs.length !== 1 || !isObject(outputs[0])) {
    fail("expected exactly one output (multi-output models are not supported)");
  }
  const output = outputs[0];
  const task = output.task;
  const link = output.link;
  let classes: unknown[] | undefined;
  if (task === "classification") {
    if (!Array.isArray(output.classes)) fail("classification output has no classes");
    classes = output.classes;
    if (classes.length !== 2) {
      fail(`multiclass models are not supported (${classes.length} classes)`);
    }
    if (link !== "logit") fail(`classification link ${JSON.stringify(link)} is not supported (only logit)`);
  } else if (task === "regression") {
    if (link !== "identity") fail(`regression link ${JSON.stringify(link)} is not supported (only identity)`);
  } else {
    fail(`unsupported task ${JSON.stringify(task)}`);
  }

  const interceptRaw = inner.intercept;
  const interceptArr = Array.isArray(interceptRaw) ? interceptRaw : [interceptRaw];
  if (interceptArr.length !== 1) fail("expected a single intercept (multiclass is not supported)");
  const intercept = jsonNumber(interceptArr[0], "intercept");

  if (!Array.isArray(inner.features)) fail("features is missing");
  const features = inner.features.map(parseFeature);
  const byName = new Map<string, number>();
  features.forEach((f, i) => {
    if (byName.has(f.name)) fail(`duplicate feature name "${f.name}"`);
    byName.set(f.name, i);
  });

  if (!Array.isArray(inner.terms)) fail("terms is missing");
  const terms = inner.terms.map((rawTerm, ti): EbmTerm => {
    if (!isObject(rawTerm)) fail(`terms[${ti}] is not an object`);
    const names = rawTerm.term_features;
    if (!Array.isArray(names) || names.length === 0) fail(`terms[${ti}].term_features is missing`);
    const featureIndexes = names.map((n) => {
      const idx = typeof n === "string" ? byName.get(n) : undefined;
      if (idx === undefined) fail(`terms[${ti}] uses unknown feature ${JSON.stringify(n)}`);
      return idx;
    });
    const levelIndexes = featureIndexes.map(
      (fi) => Math.min(features[fi].levels.length, featureIndexes.length) - 1,
    );
    const shape = featureIndexes.map((fi, d) => binCount(features[fi], levelIndexes[d]));
    const name = (names as string[]).join(" & ");
    const scores = flattenScores(rawTerm.scores, shape, `term "${name}"`);
    return { name, features: names as string[], featureIndexes, levelIndexes, shape, scores };
  });

  return { task, link, classes, intercept, features, terms };
}

const DIGITS = String.raw`\d(?:_?\d)*`;
const DECIMAL_TEXT = new RegExp(
  String.raw`^[+-]?(?:${DIGITS}(?:\.(?:${DIGITS})?)?|\.${DIGITS})(?:[eE][+-]?${DIGITS})?$`,
);

/**
 * Reads text the way Python's float() does, which is what interpret uses:
 * surrounding whitespace, "1_000", "1e3", "inf", "-Infinity" and "nan" are
 * all accepted. Returns undefined for text that isn't a number.
 */
function parsePythonFloat(raw: string): number | undefined {
  const text = raw.trim();
  if (DECIMAL_TEXT.test(text)) return Number(text.replace(/_/g, ""));
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(text);
  if (!special) return undefined;
  if (special[2].toLowerCase() === "nan") return NaN;
  return special[1] === "-" ? -Infinity : Infinity;
}

/** Bin index for one value; -1 means unknown (the table's last bin). */
function binIndex(feature: EbmFeature, level: number, value: EbmValue): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isNaN(value)) return 0;

  if (feature.kind === "continuous") {
    const x = typeof value === "number" ? value : parsePythonFloat(value);
    if (x === undefined) return -1;
    if (Number.isNaN(x)) return 0;
    const cuts = feature.levels[level];
    // Count cuts <= x (upper bound), so a value on a cut goes to the bin above.
    let lo = 0;
    let hi = cuts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cuts[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  }

  const key = typeof value === "number" ? String(value) : value;
  return feature.levels[level].get(key) ?? -1;
}

/** Each term's score for one row, in term order. */
export function termScores(model: EbmModel, row: EbmRow): number[] {
  const cache = new Map<string, number>();
  return model.terms.map((term) => {
    let flat = 0;
    for (let d = 0; d < term.featureIndexes.length; d++) {
      const fi = term.featureIndexes[d];
      const level = term.levelIndexes[d];
      const key = `${fi}:${level}`;
      let bin = cache.get(key);
      if (bin === undefined) {
        const feature = model.features[fi];
        bin = binIndex(feature, level, row[feature.name]);
        cache.set(key, bin);
      }
      const size = term.shape[d];
      flat = flat * size + (bin < 0 ? size - 1 : bin);
    }
    return term.scores[flat];
  });
}

export function predict(model: EbmModel, row: EbmRow): EbmPrediction {
  const scores = termScores(model, row);
  let score = model.intercept;
  for (const s of scores) score += s;

  const contributions = model.terms
    .map((term, i) => ({ term: term.name, features: term.features, score: scores[i] }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  const value = model.link === "logit" ? 1 / (1 + Math.exp(-score)) : score;
  return { score, value, intercept: model.intercept, contributions };
}
