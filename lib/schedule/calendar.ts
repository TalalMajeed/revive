/**
 * Working-day calendar for turning engine offsets (working days from the data
 * date) into dates and back. Dates are ISO strings (YYYY-MM-DD) handled in
 * UTC, so the server's time zone never shifts a day.
 */

export interface WorkCalendar {
  /** 0 = Sunday .. 6 = Saturday. */
  workingWeekdays: number[];
  /** Non-working dates, YYYY-MM-DD. */
  holidays?: string[];
}

/** Monday to Saturday, the usual site week in Pakistan. */
export const SIX_DAY_WEEK: WorkCalendar = { workingWeekdays: [1, 2, 3, 4, 5, 6] };

const DAY_MS = 86_400_000;

export function parseIsoDate(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Not an ISO date: ${date}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function formatIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number): string {
  return formatIsoDate(parseIsoDate(date) + days * DAY_MS);
}

class WorkingDays {
  private readonly weekdays: boolean[];
  private readonly holidays: Set<string>;

  constructor(calendar: WorkCalendar) {
    this.weekdays = Array.from({ length: 7 }, (_, d) =>
      calendar.workingWeekdays.includes(d),
    );
    if (!this.weekdays.some(Boolean)) {
      throw new Error("Calendar has no working days");
    }
    this.holidays = new Set(calendar.holidays ?? []);
  }

  isWorking(ms: number): boolean {
    return (
      this.weekdays[new Date(ms).getUTCDay()] &&
      !this.holidays.has(formatIsoDate(ms))
    );
  }

  /** The first working day on or after `ms`. */
  onOrAfter(ms: number): number {
    while (!this.isWorking(ms)) ms += DAY_MS;
    return ms;
  }
}

export function isWorkingDay(calendar: WorkCalendar, date: string): boolean {
  return new WorkingDays(calendar).isWorking(parseIsoDate(date));
}

/**
 * The n-th working day (0-based) counting from `start`. n = 0 is `start`
 * itself, or the next working day if `start` is not one.
 */
export function workingDayAt(calendar: WorkCalendar, start: string, n: number): string {
  if (n < 0 || !Number.isInteger(n)) throw new Error(`Bad working-day index: ${n}`);
  const days = new WorkingDays(calendar);
  let ms = days.onOrAfter(parseIsoDate(start));
  for (let i = 0; i < n; i++) ms = days.onOrAfter(ms + DAY_MS);
  return formatIsoDate(ms);
}

/** Working days from `start` up to and including `end`. 0 if end < start. */
export function countWorkingDays(calendar: WorkCalendar, start: string, end: string): number {
  const days = new WorkingDays(calendar);
  const last = parseIsoDate(end);
  let count = 0;
  for (let ms = parseIsoDate(start); ms <= last; ms += DAY_MS) {
    if (days.isWorking(ms)) count++;
  }
  return count;
}

/**
 * The date an activity starting at offset 0 finishes, given its finish
 * offset. Work fills whole days: finishing at 1 means the end of the first
 * working day, and 1.2 spills into the second.
 */
export function finishOffsetToDate(calendar: WorkCalendar, start: string, finish: number): string {
  const wholeDays = Math.ceil(finish - 1e-9);
  return workingDayAt(calendar, start, Math.max(wholeDays - 1, 0));
}

/** The date of a start offset: offset 2.0 starts on the third working day. */
export function startOffsetToDate(calendar: WorkCalendar, start: string, offset: number): string {
  return workingDayAt(calendar, start, Math.max(Math.floor(offset + 1e-9), 0));
}
