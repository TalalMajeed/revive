"use client";

import { fmtDay, fmtMonth } from "@/lib/format";
import { finishOffsetToDate, parseIsoDate, type WorkCalendar } from "@/lib/schedule";
import { DAY_MS, maxDate, minDate, monthTicks, shiftDays, timeScale } from "./scale";
import { useWidth } from "./use-width";

/**
 * Where the 2,000 simulated finishes land, by week, against the contract
 * completion date. The P10–P90 band is shaded; runs past the target are in
 * the risk colour.
 */
export function FinishDistribution({
  finishes,
  dataDate,
  calendar,
  target,
  p10,
  p50,
  p90,
}: {
  finishes: number[];
  dataDate: string;
  calendar: WorkCalendar;
  target: string;
  p10: string;
  p50: string;
  p90: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 190;
  const pad = { l: 8, r: 8, t: 26, b: 26 };

  // Bucket by calendar week of the finish date.
  const counts = new Map<number, number>();
  const toDate = new Map<number, string>();
  for (const f of finishes) {
    const key = Math.round(f * 1000);
    let date = toDate.get(key);
    if (!date) toDate.set(key, (date = finishOffsetToDate(calendar, dataDate, f)));
    const ms = parseIsoDate(date);
    const dow = (new Date(ms).getUTCDay() + 6) % 7;
    const week = ms - dow * DAY_MS;
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  const weeks = [...counts.keys()].sort((a, b) => a - b);
  const first = new Date(weeks[0] ?? parseIsoDate(dataDate)).toISOString().slice(0, 10);
  const last = new Date((weeks[weeks.length - 1] ?? parseIsoDate(dataDate)) + 7 * DAY_MS).toISOString().slice(0, 10);
  const from = shiftDays(minDate(first, target), -10);
  const to = shiftDays(maxDate(last, target), 10);
  const x = timeScale(from, to, pad.l, width - pad.r);
  const maxCount = Math.max(1, ...counts.values());
  const barW = Math.max(2, 7 * DAY_MS * x.k - 2);
  const y = (c: number) => height - pad.b - (c / maxCount) * (height - pad.t - pad.b);
  const targetX = x(target);

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg width={width} height={height} role="img" aria-label={`Simulated finish dates: P10 ${fmtDay(p10)}, P50 ${fmtDay(p50)}, P90 ${fmtDay(p90)}; contract completion ${fmtDay(target)}`}>
        <rect x={x(p10)} y={pad.t - 6} width={Math.max(1, x(p90) - x(p10))} height={height - pad.t - pad.b + 6} fill="var(--panel)" />
        {monthTicks(from, to, Math.floor(width / 70)).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={height - pad.b} y2={height - pad.b + 4} stroke="var(--rule-strong)" />
            <text x={x(t)} y={height - 8} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
              {fmtMonth(t)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="var(--rule-strong)" />
        {weeks.map((w) => {
          const date = new Date(w).toISOString().slice(0, 10);
          const bx = x(date) + 1;
          const late = parseIsoDate(date) + 6 * DAY_MS > parseIsoDate(target);
          return (
            <rect key={w} x={bx} y={y(counts.get(w)!)} width={barW} height={height - pad.b - y(counts.get(w)!)} fill={late ? "var(--risk)" : "var(--ink)"} opacity={late ? 0.85 : 0.75} />
          );
        })}
        <line x1={x(p50)} x2={x(p50)} y1={pad.t - 6} y2={height - pad.b} stroke="var(--ink)" strokeWidth="1.5" />
        <text x={x(p50)} y={pad.t - 10} fontSize="11" textAnchor="middle" fill="var(--ink)" fontWeight="600">
          P50 {fmtDay(p50)}
        </text>
        <line x1={targetX} x2={targetX} y1={pad.t - 6} y2={height - pad.b} stroke="var(--risk)" strokeWidth="1.5" strokeDasharray="4 3" />
        <text
          x={targetX + (targetX > width - 120 ? -4 : 4)}
          y={pad.t + 8}
          fontSize="11"
          textAnchor={targetX > width - 120 ? "end" : "start"}
          fill="var(--risk)"
        >
          Contract {fmtDay(target)}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-ink-2">
        <span>Shaded: 80% of runs finish between {fmtDay(p10)} and {fmtDay(p90)}</span>
        <span>Bars: simulated finishes per week</span>
      </div>
    </div>
  );
}
