"use client";

import { fmtMonth } from "@/lib/format";
import { linear, maxDate, minDate, monthTicks, timeScale } from "./scale";
import { useWidth } from "./use-width";

type Point = { date: string; percent: number };

/** Planned against actual % complete, weighted by duration. */
export function SCurve({ planned, actual, dataDate }: { planned: Point[]; actual: Point[]; dataDate: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = 220;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const from = minDate(planned[0]?.date ?? dataDate, actual[0]?.date);
  const to = maxDate(planned[planned.length - 1]?.date ?? dataDate, dataDate);
  const x = timeScale(from, to, pad.l, width - pad.r);
  const y = linear(0, 100, height - pad.b, pad.t);
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.percent).toFixed(1)}`).join("");
  const last = actual[actual.length - 1];

  return (
    <div ref={ref} className="w-full min-w-0 overflow-hidden">
      <svg width={width} height={height} role="img" aria-label="Planned and actual percent complete over time">
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--rule)" />
            <text x={pad.l - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="var(--ink-2)">
              {v}%
            </text>
          </g>
        ))}
        {monthTicks(from, to, Math.floor(width / 70)).map((t) => (
          <text key={t} x={x(t)} y={height - 8} fontSize="11" textAnchor="middle" fill="var(--ink-2)">
            {fmtMonth(t)}
          </text>
        ))}
        <path d={path(planned)} fill="none" stroke="var(--plan)" strokeWidth="1.5" strokeDasharray="5 4" />
        <path d={path(actual)} fill="none" stroke="var(--ink)" strokeWidth="2" />
        <line x1={x(dataDate)} x2={x(dataDate)} y1={pad.t} y2={height - pad.b} stroke="var(--ink-3)" strokeDasharray="2 3" />
        {last ? (
          <>
            <circle cx={x(last.date)} cy={y(last.percent)} r="3.5" fill="var(--ink)" />
            <text x={x(last.date) - 6} y={y(last.percent) - 8} fontSize="11" textAnchor="end" fill="var(--ink)" fontWeight="600">
              Actual {last.percent.toFixed(0)}%
            </text>
          </>
        ) : null}
      </svg>
      <div className="mt-1 flex gap-5 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="var(--plan)" strokeWidth="1.5" strokeDasharray="5 3" /></svg>
          Planned
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden="true"><line x1="0" x2="16" y1="3" y2="3" stroke="var(--ink)" strokeWidth="2" /></svg>
          Actual
        </span>
      </div>
    </div>
  );
}
