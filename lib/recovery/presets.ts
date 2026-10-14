import type { CrashOption } from "./optimise";

/**
 * Default ways to speed an activity up, used when the planner has not entered
 * their own. These are PLACEHOLDERS until they are calibrated on finished
 * projects: the share of the remaining work each option can save and its
 * premium over the normal daily rate are rough rules of thumb, not data.
 */
export const OVERTIME_MAX_SHARE = 0.15;
export const OVERTIME_RATE_MULTIPLIER = 1.5;
export const EXTRA_CREW_MAX_SHARE = 0.2;
export const EXTRA_CREW_RATE_MULTIPLIER = 2.5;

/**
 * Overtime saves up to 15% of the remaining duration at 1.5 times the daily
 * rate per day saved; an extra crew saves a further 20% at 2.5 times. An
 * activity with nothing left to do gets no options.
 */
export function defaultCrashOptions(
  activity: { id: string; duration: number },
  dailyRatePkr: number,
): CrashOption[] {
  const d = activity.duration;
  if (!(d > 0) || !Number.isFinite(d)) return [];
  const rate = Number.isFinite(dailyRatePkr) && dailyRatePkr > 0 ? dailyRatePkr : 0;
  return [
    {
      id: "overtime",
      label: "Overtime",
      maxDaysSaved: d * OVERTIME_MAX_SHARE,
      costPerDayPkr: rate * OVERTIME_RATE_MULTIPLIER,
    },
    {
      id: "extra-crew",
      label: "Extra crew",
      maxDaysSaved: d * EXTRA_CREW_MAX_SHARE,
      costPerDayPkr: rate * EXTRA_CREW_RATE_MULTIPLIER,
    },
  ];
}

/**
 * Average value of one working day of the contract. Returns 0 when there is
 * no contract value or no working days to spread it over.
 */
export function dailyRateFromContract(
  contractValuePkr: number,
  totalOriginalWorkingDays: number,
): number {
  if (!Number.isFinite(contractValuePkr) || contractValuePkr <= 0) return 0;
  if (!Number.isFinite(totalOriginalWorkingDays) || totalOriginalWorkingDays <= 0) return 0;
  return contractValuePkr / totalOriginalWorkingDays;
}

/** Default options for every activity in a network, keyed by activity id. */
export function defaultOptionsForNetwork(
  activities: ReadonlyArray<{ id: string; duration: number }>,
  dailyRatePkr: number,
): Record<string, CrashOption[]> {
  // No prototype, so an activity id such as "__proto__" is just a key.
  const out = Object.create(null) as Record<string, CrashOption[]>;
  for (const a of activities) {
    const opts = defaultCrashOptions(a, dailyRatePkr);
    if (opts.length > 0) out[a.id] = opts;
  }
  return out;
}
