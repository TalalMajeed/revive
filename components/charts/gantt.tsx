"use client";

import { fmtDay, fmtMonth } from "@/lib/format";
import type { ActivityForecast } from "@/lib/progress/status";
import { maxDate, minDate, monthTicks, shiftDays, timeScale } from "./scale";
import { useWidth } from "./use-width";

/**
 * Baseline (thin, grey) under the forecast bar. Critical activities are in
 * the risk colour; progress fills the bar; milestones are diamonds.
 */
export function Gantt({
  activities,
  dataDate,
  target,
}: {
  activities: ActivityForecast[];
  dataDate: string;
  target: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelW = width < 640 ? 150 : 270;
  const chartW = Math.max(width, 640);
  const rowH = 24;
  const top = 26;
  const height = top + activities.length * rowH + 8;
  const from = shiftDays(minDate(...activities.map((a) => a.baselineStart), ...activities.map((a) => a.start)), -7);
  const to = shiftDays(maxDate(target, ...activities.map((a) => a.baselineFinish), ...activities.map((a) => a.finish)), 10);
  const x = timeScale(from, to, labelW + 8, chartW - 10);
  const end = (d: string) => x(shiftDays(d, 1));

  return (
    <div ref={ref} className="w-full overflow-x-auto">
      <svg width={chartW} height={height} role="img" aria-label="Gantt chart: baseline and forecast bars for each activity">
        {monthTicks(from, to, Math.floor((chartW - labelW) / 64)).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 6} y2={height} stroke="var(--rule)" />
            <text x={x(t) + 3} y={top - 10} fontSize="11" fill="var(--ink-2)">
              {fmtMonth(t)}
            </text>
          </g>
        ))}
        {activities.map((a, i) => {
          const y = top + i * rowH;
          const mid = y + rowH / 2;
          const colour = a.status === "complete" ? "var(--ink-3)" : a.critical ? "var(--risk)" : "var(--ink)";
          const fx0 = x(a.start);
          const fx1 = Math.max(end(a.finish), fx0 + 2);
          return (
            <g key={a.id}>
              {i % 2 === 1 ? <rect x={0} y={y} width={chartW} height={rowH} fill="var(--panel)" opacity="0.45" /> : null}
              <text x={4} y={mid + 4} fontSize="12" fill="var(--ink)">
                <tspan fontFamily="var(--font-plex-mono)" fontSize="11" fill="var(--ink-2)">
                  {a.code}
                </tspan>
                <tspan dx="6">{truncate(a.name, labelW < 200 ? 14 : 30)}</tspan>
                <title>{`${a.code} ${a.name}\nPlanned ${fmtDay(a.baselineStart)}–${fmtDay(a.baselineFinish)}\nForecast ${fmtDay(a.start)}–${fmtDay(a.finish)}${a.slipDays > 0 ? `, ${a.slipDays} days late` : ""}`}</title>
              </text>
              {a.isMilestone ? (
                <>
                  <path d={diamond(x(a.baselineFinish), mid + 5, 4)} fill="none" stroke="var(--plan)" />
                  <path d={diamond(end(a.finish), mid - 1, 6)} fill={colour} />
                </>
              ) : (
                <>
                  <rect x={x(a.baselineStart)} y={mid + 5} width={Math.max(end(a.baselineFinish) - x(a.baselineStart), 2)} height={3} fill="var(--plan)" opacity="0.7" />
                  <rect x={fx0} y={mid - 7} width={fx1 - fx0} height={10} rx={1.5} fill={colour} opacity={a.status === "complete" ? 0.55 : 0.25} />
                  <rect x={fx0} y={mid - 7} width={(fx1 - fx0) * (a.percentComplete / 100)} height={10} rx={1.5} fill={colour} />
                </>
              )}
            </g>
          );
        })}
        <line x1={x(dataDate)} x2={x(dataDate)} y1={top - 6} y2={height} stroke="var(--ink)" strokeWidth="1.25" />
        <line x1={end(target)} x2={end(target)} y1={top - 6} y2={height} stroke="var(--risk)" strokeWidth="1.25" strokeDasharray="4 3" />
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        <Key swatch={<rect width="14" height="8" y="2" fill="var(--risk)" />} label="Critical path" />
        <Key swatch={<rect width="14" height="8" y="2" fill="var(--ink)" />} label="Has float" />
        <Key swatch={<rect width="14" height="3" y="5" fill="var(--plan)" />} label="Baseline" />
        <Key swatch={<line x1="7" x2="7" y1="0" y2="12" stroke="var(--ink)" strokeWidth="1.5" />} label="Data date" />
        <Key swatch={<line x1="7" x2="7" y1="0" y2="12" stroke="var(--risk)" strokeWidth="1.5" strokeDasharray="3 2" />} label="Contract completion" />
      </div>
    </div>
  );
}

function Key({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="14" height="12" aria-hidden="true">
        {swatch}
      </svg>
      {label}
    </span>
  );
}

function diamond(cx: number, cy: number, r: number) {
  return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
