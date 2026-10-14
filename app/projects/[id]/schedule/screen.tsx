"use client";

import { useMemo, useState } from "react";
import { Gantt } from "@/components/charts/gantt";
import { SCurve } from "@/components/charts/s-curve";
import { useProjectData } from "@/components/project-context";
import { Badge, Button, Section } from "@/components/ui";
import { fmtDay } from "@/lib/format";
import { progressCurves } from "@/lib/progress/status";

export default function SchedulePage() {
  const { bundle, forecast } = useProjectData();
  const { status } = forecast;
  const [criticalOnly, setCriticalOnly] = useState(false);
  const curves = useMemo(() => progressCurves(bundle), [bundle]);
  const rows = criticalOnly ? status.activities.filter((a) => a.critical) : status.activities;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-6 sm:px-6">
      <Section
        title="Programme"
        aside={
          <div className="flex items-center gap-2">
            <span>{status.activities.filter((a) => a.critical).length} activities on the critical path</span>
            <Button variant={criticalOnly ? "primary" : "secondary"} onClick={() => setCriticalOnly((v) => !v)} aria-pressed={criticalOnly}>
              Critical only
            </Button>
          </div>
        }
      >
        <Gantt activities={rows} dataDate={status.dataDate} target={status.targetDate} />
      </Section>

      <div className="grid grid-cols-1 gap-x-10 gap-y-10 lg:grid-cols-[1.3fr_1fr]">
        <Section title="Progress against plan">
          <SCurve planned={curves.planned} actual={curves.actual} dataDate={status.dataDate} />
        </Section>
        <Section title="Earned schedule">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <Stat term="Done" value={`${status.actualPercent.toFixed(1)}%`} />
            <Stat term="Planned by now" value={`${status.plannedPercent.toFixed(1)}%`} />
            <Stat term="Time elapsed" value={`${Math.round(status.actualTimeDays)} working days`} />
            <Stat term="Earned schedule" value={`${Math.round(status.earnedScheduleDays)} working days`} />
            <Stat term="Pace, SPI(t)" value={status.spiT.toFixed(2)} tone={status.spiT < 0.9 ? "risk" : undefined} />
            <Stat
              term="Behind the baseline"
              value={`${Math.max(status.daysBehindBaseline, 0)} working days`}
              tone={status.daysBehindBaseline > 0 ? "risk" : undefined}
            />
          </dl>
          <p className="mt-4 text-xs leading-5 text-ink-2">
            Earned schedule is the point in the plan where today&apos;s progress was due. Pace below 1 means work is
            taking longer than planned.
          </p>
        </Section>
      </div>

      <Section title="Activities" aside={`Forecast at ${fmtDay(status.dataDate)}, working days`}>
        <div className="overflow-x-auto border-y border-rule">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="bg-panel text-left text-xs text-ink-2">
                <th className="px-3 py-2 font-medium">Activity</th>
                <th className="px-3 py-2 text-right font-medium">Done</th>
                <th className="px-3 py-2 text-right font-medium">Left</th>
                <th className="px-3 py-2 font-medium">Planned finish</th>
                <th className="px-3 py-2 font-medium">Forecast finish</th>
                <th className="px-3 py-2 text-right font-medium">Late by</th>
                <th className="px-3 py-2 text-right font-medium">Float</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {status.activities.map((a) => (
                <tr key={a.id} className={a.status === "complete" ? "text-ink-2" : ""}>
                  <td className="px-3 py-2">
                    <span className="mr-2 font-mono text-[0.8125rem] text-ink-2">{a.code}</span>
                    {a.name}
                    {a.critical ? <Badge tone="risk" className="ml-2">critical</Badge> : null}
                  </td>
                  <td className="px-3 py-2 text-right">{a.percentComplete.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right">{a.remaining > 0 ? a.remaining.toFixed(0) : "—"}</td>
                  <td className="px-3 py-2">{fmtDay(a.baselineFinish)}</td>
                  <td className="px-3 py-2">{fmtDay(a.finish)}</td>
                  <td className={`px-3 py-2 text-right ${a.slipDays > 0 ? "text-risk" : ""}`}>{a.slipDays > 0 ? a.slipDays : "—"}</td>
                  <td className="px-3 py-2 text-right">{a.status === "complete" ? "—" : Math.round(a.totalFloat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </main>
  );
}

function Stat({ term, value, tone }: { term: string; value: string; tone?: "risk" }) {
  return (
    <div>
      <dt className="text-xs text-ink-2">{term}</dt>
      <dd className={`mt-0.5 text-lg font-semibold ${tone === "risk" ? "text-risk" : ""}`}>{value}</dd>
    </div>
  );
}
