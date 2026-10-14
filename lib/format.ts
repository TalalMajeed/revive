/** Display formatting shared by the screens and the templated reasons. */

export function fmtDate(date: string | undefined | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtDay(date: string | undefined | null): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtMonth(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

/** PKR in lakh and crore, the way contractors quote it. */
export function pkr(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return "—";
  if (amount >= 1e7) return `Rs ${(amount / 1e7).toFixed(amount >= 1e9 ? 0 : 2)} crore`;
  if (amount >= 1e5) return `Rs ${(amount / 1e5).toFixed(1)} lakh`;
  return `Rs ${Math.round(amount).toLocaleString("en-PK")}`;
}

export function days(n: number): string {
  const r = Math.round(n);
  return `${r} ${Math.abs(r) === 1 ? "day" : "days"}`;
}
