"use client";

import type { ForecastRecord } from "@/lib/data/types";
import { fmtDay, fmtMonth } from "@/lib/format";
import { linear, maxDate, minDate, monthTicks, shiftDays, timeScale } from "./scale";
import { useWidth } from "./use-width";

/**
 * The forecast log over time. Top: chance of finishing late each week.
 * Bottom: the P10–P90 finish range each week against the contract date
 * (and the actual finish, for a completed project).
 */
export function ForecastTrend({
  forecasts,
  target,
  actualFinish,
  selected,
  onSelect,
  firstWarning,
}: {
  forecasts: ForecastRecord[];
  target: string;
  actualFinish?: string;
  selected?: number;
  onSelect?: (i: number) => void;
  firstWarning?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const pad = { l: 44, r: 14 };
  const topH = 120;
  const gap = 34;
  const botH = 170;
  const height = 14 + topH + gap + botH + 28;
  if (forecasts.length === 0) return null;
  const from = forecasts[0].asOf;
  const to = maxDate(forecasts[forecasts.length - 1].asOf, actualFinish);
  const x = timeScale(from, to, pad.l, width - pad.r);
  const yP = linear(0, 1, 14 + topH, 14);
  const lo = shiftDays(minDate(target, ...forecasts.map((f) => f.p10)), -14);
  const hi = shiftDays(maxDate(target, actualFinish, ...forecasts.map((f) => f.p90)), 14);
  const b0 = 14 + topH + gap;
  const yD = timeScale(lo, hi, b0 + botH, b0);
  const line = forecasts.map((f, i) => `${i ? "L" : "M"}${x(f.asOf).toFixed(1)} ${yP(f.probabilityLate).toFixed(1)}`).join("");
  const band =
    forecasts.map((f, i) => `${i ? "L" : "M"}${x(f.asOf).toFixed(1)} ${yD(f.p90).toFixed(1)}`).join("") +
    [...forecasts].reverse().map((f) => `L${x(f.asOf).toFixed(1)} ${yD(f.p10).toFixed(1)}`).join("") +
    "Z";
  const p50 = forecasts.map((f, i) => `${i ? "L" : "M"}${x(f.asOf).toFixed(1)} ${yD(f.p50).toFixed(1)}`).join("");
  const sel = selected !== undefined ? forecasts[selected] : undefined;
  const warn = firstWarning !== undefined ? forecasts[firstWarning] : undefined;

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Weekly forecast history: chance of finishing late and the likely finish range"
        onClick={(e) => {
          if (!onSelect) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const mx = e.clientX - rect.left;
          let best = 0;
          forecasts.forEach((f, i) => {
            if (Math.abs(x(f.asOf) - mx) < Math.abs(x(forecasts[best].asOf) - mx)) best = i;
          });
          onSelect(best);
        }}
        className={onSelect ? "cursor-crosshair" : undefined}
      >
        {/* Chance of finishing late */}
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={yP(v)} y2={yP(v)} stroke={v === 0.5 ? "var(--rule-strong)" : "var(--rule)"} strokeDasharray={v === 0.5 ? "3 3" : undefined} />
            <text x={pad.l - 6} y={yP(v) + 4} fontSize="11" textAnchor="end" fill="var(--ink-2)">
              {v * 100}%
            </text>
          </g>
        ))}
        <text x={pad.l} y={10} fontSize="11" fill="var(--ink-2)">
          Chance of finishing after the contract date
        </text>
        <path d={line} fill="none" stroke="var(--risk)" strokeWidth="2" />

        {/* Finish range */}
        <text x={pad.l} y={b0 - 8} fontSize="11" fill="var(--ink-2)">
          Likely finish (P10–P90 band, P50 line)
        </text>
        {monthTicks(lo, hi, 6).map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={yD(t)} y2={yD(t)} stroke="var(--rule)" />
            <text x={pad.l - 6} y={yD(t) + 4} fontSize="11" textAnchor="end" fill="var(--ink-2)">
              {fmtMonth(t)}
            </text>
          </g>
        ))}
        <path d={band} fill="var(--ink)" opacity="0.12" />
        <path d={p50} fill="none" stroke="var(--ink)" strokeWidth="1.75" />
        <line x1={pad.l} x2={width - pad.r} y1={yD(target)} y2={yD(target)} stroke="var(--risk)" strokeDasharray="4 3" />
        <text x={width - pad.r} y={yD(target) - 5} fontSize="11" textAnchor="end" fill="var(--risk)">
          Contract {fmtDay(target)}
        </text>
        {actualFinish ? (
          <>
            <line x1={pad.l} x2={width - pad.r} y1={yD(actualFinish)} y2={yD(actualFinish)} stroke="var(--ink)" strokeDasharray="1 3" />
            <text x={width - pad.r} y={yD(actualFinish) - 5} fontSize="11" textAnchor="end" fill="var(--ink)">
              Actual finish {fmtDay(actualFinish)}
            </text>
          </>
        ) : null}

        {/* Time axis */}
        {monthTicks(from, to, Math.floor(width / 70)).map((t) => (
          <text key={t} x={x(t)} y={height - 8} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
            {fmtMonth(t)}
          </text>
        ))}

        {warn ? (
          <g>
            <line x1={x(warn.asOf)} x2={x(warn.asOf)} y1={14} y2={b0 + botH} stroke="var(--risk)" strokeWidth="1" />
            <circle cx={x(warn.asOf)} cy={yP(warn.probabilityLate)} r="4" fill="var(--risk)" />
          </g>
        ) : null}
        {sel ? (
          <g>
            <line x1={x(sel.asOf)} x2={x(sel.asOf)} y1={14} y2={b0 + botH} stroke="var(--ink)" strokeWidth="1.5" />
            <circle cx={x(sel.asOf)} cy={yP(sel.probabilityLate)} r="4.5" fill="var(--sheet)" stroke="var(--ink)" strokeWidth="2" />
            <circle cx={x(sel.asOf)} cy={yD(sel.p50)} r="4" fill="var(--ink)" />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
