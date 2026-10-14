"use client";

import Link from "next/link";
import { useMemo } from "react";
import { FinishDistribution } from "@/components/charts/finish-distribution";
import { ForecastTrend } from "@/components/charts/trend";
import { useProjectData } from "@/components/project-context";
import { Badge, LearningNote, LinkButton, OwnerTag, Section, healthLabel, healthTone } from "@/components/ui";
import { predictAwardRisk } from "@/lib/forecast/award";
import { days, fmtDate, fmtDay, pct } from "@/lib/format";
import { calendarOf } from "@/lib/progress/state";

export default function WeeklyCard() {
  const { bundle, forecast } = useProjectData();
  const { status, simulation, record } = forecast;
  const base = `/projects/${encodeURIComponent(bundle.project.id)}`;
  const done = bundle.project.status === "completed";
  const award = useMemo(() => predictAwardRisk(bundle.project.setup), [bundle.project.setup]);
  const log = useMemo(() => [...bundle.forecasts].sort((a, b) => a.asOf.localeCompare(b.asOf)), [bundle.forecasts]);

  const drivers = Object.entries(simulation.criticality)
    .map(([id, share]) => ({ a: status.activities.find((x) => x.id === id)!, share }))
    .filter((d) => d.a && d.share > 0.05 && d.a.status !== "complete" && !d.a.isMilestone)
    .sort((x, y) => y.share - x.share)
    .slice(0, 6);

  const late = status.daysLate > 0;
  const tone = healthTone(record.healthScore);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      {done ? (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-rule bg-sheet px-4 py-3 text-sm">
          <span>
            Finished on {fmtDate(bundle.project.actualCompletionDate)},{" "}
            <strong className={late ? "text-risk" : ""}>
              {late ? `${days(status.daysLate)} after` : `${days(-status.daysLate)} before`} the contract completion date
            </strong>
            .
          </span>
          <LinkButton href={`${base}/replay`} variant="primary">
            Replay week by week
          </LinkButton>
        </div>
      ) : null}

      {/* Readout */}
      <div className="grid grid-cols-1 overflow-hidden rounded-[6px] border border-rule bg-sheet sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-rule">
        <Cell label="Health">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight">{record.healthScore}</span>
            <span className="text-sm text-ink-2">/ 100</span>
            <Badge tone={tone} className="ml-auto">{healthLabel(record.healthScore)}</Badge>
          </div>
          <Scale value={record.healthScore} />
        </Cell>
        <Cell label={`Chance of finishing after ${fmtDay(status.targetDate)}`}>
          <span className={`text-4xl font-semibold tracking-tight ${record.probabilityLate >= 0.5 ? "text-risk" : ""}`}>
            {pct(record.probabilityLate)}
          </span>
          <p className="mt-2 text-xs text-ink-2">{simulation.iterations.toLocaleString()} simulated runs of the remaining schedule</p>
        </Cell>
        <Cell label="Likely finish (P50)">
          <span className={`text-2xl font-semibold tracking-tight ${record.p50 > status.targetDate ? "text-risk" : ""}`}>
            {fmtDate(record.p50)}
          </span>
          <p className="mt-2 text-xs text-ink-2">
            80% range {fmtDay(record.p10)} – {fmtDate(record.p90)}
          </p>
        </Cell>
        <Cell label="Against the contract date">
          <span className={`text-2xl font-semibold tracking-tight ${late ? "text-risk" : "text-ok"}`}>
            {late ? `${days(status.daysLate)} late` : `${days(-status.daysLate)} in hand`}
          </span>
          <p className="mt-2 text-xs text-ink-2">
            {status.actualPercent.toFixed(0)}% done, {status.plannedPercent.toFixed(0)}% planned · pace{" "}
            {status.spiT.toFixed(2)}
          </p>
        </Cell>
      </div>
      <div className="mt-2">
        <LearningNote>
          Learning: this forecast comes from the schedule and simulation alone. The explainable model gets weight only
          after it beats the simulation on finished projects.
        </LearningNote>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[1.15fr_1fr]">
        <Section title="Why it's slipping" aside={record.reasons.length ? "Largest effect first" : undefined}>
          {record.reasons.length === 0 ? (
            <p className="text-sm text-ink-2">No warning signs this week: payments on time, no open queries, critical work on plan.</p>
          ) : (
            <ol className="space-y-5">
              {record.reasons.map((r, i) => (
                <li key={r.key} className="grid grid-cols-[1.5rem_1fr] gap-x-2">
                  <span className="pt-0.5 text-sm font-semibold text-ink-3">{i + 1}</span>
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <h3 className="font-medium leading-6 text-ink">{r.title}</h3>
                      <OwnerTag owner={r.owner} />
                    </div>
                    <p className="mt-1 text-sm leading-6 text-ink-2">{r.detail}</p>
                    <p className="mt-1.5 text-sm leading-6">
                      <span className="font-medium">This week: </span>
                      {r.action}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {!done ? (
            <div className="mt-6 flex flex-wrap gap-2">
              <LinkButton href={`${base}/recovery`}>Cheapest way back</LinkButton>
              <LinkButton href={`${base}/eot`}>EOT evidence pack</LinkButton>
            </div>
          ) : null}
        </Section>

        <div className="space-y-8">
          <Section title="When it will finish">
            {simulation.finishes && !done ? (
              <FinishDistribution
                finishes={simulation.finishes}
                dataDate={status.dataDate}
                calendar={calendarOf(bundle)}
                target={status.targetDate}
                p10={record.p10}
                p50={record.p50}
                p90={record.p90}
              />
            ) : (
              <p className="text-sm text-ink-2">Finished on {fmtDate(bundle.project.actualCompletionDate)}.</p>
            )}
          </Section>

          {drivers.length ? (
            <Section title="What drives the finish" aside="Share of runs on the critical path">
              <ul className="space-y-2.5">
                {drivers.map(({ a, share }) => (
                  <li key={a.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-sm">
                    <span className="truncate">
                      <span className="mr-2 font-mono text-[0.8125rem] text-ink-2">{a.code}</span>
                      {a.name}
                    </span>
                    <span className="w-10 text-right font-medium">{pct(share)}</span>
                    <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-panel">
                      <span className="block h-full bg-ink" style={{ width: `${share * 100}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>

      {log.length > 1 ? (
        <Section title="Forecast log" className="mt-10" aside={<Link href={`${base}/replay`} className="text-ink underline">Replay</Link>}>
          <ForecastTrend forecasts={log} target={status.targetDate} actualFinish={bundle.project.actualCompletionDate} />
        </Section>
      ) : null}

      <Section title="Risk at contract award" className="mt-10" aside={`${pct(award.probabilityLate)} chance of finishing a month or more late`}>
        <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {award.reasons.map((r) => (
            <li key={r.feature} className="flex items-center justify-between gap-3 border-b border-rule pb-2">
              <span>{r.label}</span>
              <Badge tone={r.direction === "raises" ? "risk" : "ok"}>{r.direction === "raises" ? "raises risk" : "lowers risk"}</Badge>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <LearningNote>
            Explainable Boosting Machine evaluated in the browser from its JSON export. This demo model is trained on
            synthetic data, so its numbers are illustrative only.
          </LearningNote>
        </div>
      </Section>
    </main>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-rule p-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:[&:nth-child(odd)]:border-r-0">
      <p className="mb-2 text-sm text-ink-2">{label}</p>
      {children}
    </div>
  );
}

/** 0–100 with the three bands marked, and where this project sits. */
function Scale({ value }: { value: number }) {
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative flex h-1.5 overflow-hidden rounded-full">
        <span className="h-full bg-risk/70" style={{ width: "40%" }} />
        <span className="h-full bg-warn/60" style={{ width: "30%" }} />
        <span className="h-full bg-ok/60" style={{ width: "30%" }} />
      </div>
      <div className="relative h-2">
        <span className="absolute -top-0.5 h-0 w-0 -translate-x-1/2 border-x-[5px] border-b-[6px] border-x-transparent border-b-ink" style={{ left: `${value}%` }} />
      </div>
    </div>
  );
}
