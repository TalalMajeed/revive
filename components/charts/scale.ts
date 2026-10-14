import { parseIsoDate } from "@/lib/schedule";

export const DAY_MS = 86_400_000;

export function timeScale(from: string, to: string, x0: number, x1: number) {
  const a = parseIsoDate(from);
  const b = Math.max(parseIsoDate(to), a + DAY_MS);
  const k = (x1 - x0) / (b - a);
  const scale = (date: string) => x0 + (parseIsoDate(date) - a) * k;
  return Object.assign(scale, { a, b, k });
}

export function linear(d0: number, d1: number, r0: number, r1: number) {
  const k = (r1 - r0) / (d1 - d0 || 1);
  return (v: number) => r0 + (v - d0) * k;
}

/** First-of-month ticks between two dates, thinned to fit. */
export function monthTicks(from: string, to: string, maxTicks = 12): string[] {
  const a = new Date(parseIsoDate(from));
  const b = parseIsoDate(to);
  const ticks: string[] = [];
  const d = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
  while (d.getTime() <= b) {
    ticks.push(d.toISOString().slice(0, 10));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const step = Math.max(1, Math.ceil(ticks.length / maxTicks));
  return ticks.filter((_, i) => i % step === 0);
}

export function minDate(...dates: Array<string | undefined>): string {
  return dates.filter((d): d is string => !!d).reduce((m, d) => (d < m ? d : m));
}

export function maxDate(...dates: Array<string | undefined>): string {
  return dates.filter((d): d is string => !!d).reduce((m, d) => (d > m ? d : m));
}

export function shiftDays(date: string, n: number): string {
  return new Date(parseIsoDate(date) + n * DAY_MS).toISOString().slice(0, 10);
}
