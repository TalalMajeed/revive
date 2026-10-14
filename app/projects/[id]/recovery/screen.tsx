"use client";

import { useState } from "react";
import { useProjectData } from "@/components/project-context";
import { Badge, Button, Field, LearningNote, Section } from "@/components/ui";
import { newId } from "@/lib/data/store";
import type { RecoveryPlanRecord } from "@/lib/data/types";
import { fmtDate, pkr } from "@/lib/format";
import { calendarOf, remainingNetwork } from "@/lib/progress/state";
import type { RecoveryResult } from "@/lib/recovery/optimise";
import { dailyRateFromContract, defaultOptionsForNetwork, EXTRA_CREW_MAX_SHARE, EXTRA_CREW_RATE_MULTIPLIER, OVERTIME_MAX_SHARE, OVERTIME_RATE_MULTIPLIER } from "@/lib/recovery/presets";
import { countWorkingDays, finishOffsetToDate } from "@/lib/schedule";

export default function RecoveryPage() {
  const { bundle, forecast, save } = useProjectData();
  const { status } = forecast;
  const cal = calendarOf(bundle);
  const contract = bundle.project.setup.contract_value_pkr ?? 0;
  const totalDays = bundle.activities.reduce((s, a) => s + a.originalDurationDays, 0);
  const defaultRate = Math.round(dailyRateFromContract(contract, totalDays));

  const [target, setTarget] = useState(status.targetDate);
  const [budget, setBudget] = useState("");
  const [rate, setRate] = useState(defaultRate ? String(defaultRate) : "");
  const [result, setResult] = useState<RecoveryResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const network = remainingNetwork(bundle, status.state);
  const names = new Map(bundle.activities.map((a) => [a.id, a]));
  const done = bundle.project.status === "completed";

  const run = async () => {
    setError(null);
    setSaved(false);
    const dailyRate = Number(rate.replace(/[,\s]/g, ""));
    if (!(dailyRate > 0)) {
      setError("Enter what one working day of the contract is worth, to price the speed-ups.");
      return;
    }
    const budgetPkr = budget.trim() ? Number(budget.replace(/[,\s]/g, "")) : undefined;
    if (budgetPkr !== undefined && !(budgetPkr >= 0)) {
      setError("The budget must be a number.");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          network,
          options: defaultOptionsForNetwork(network.activities, dailyRate),
          targetFinish: Math.max(countWorkingDays(cal, status.dataDate, target), 0),
          budgetPkr,
        }),
      });
      const body = (await res.json()) as RecoveryResult;
      if (!res.ok || body.status === "error") throw new Error(body.message ?? `The optimiser returned ${res.status}`);
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const newFinish = result ? finishOffsetToDate(cal, status.dataDate, result.newFinish) : null;
  const oldFinish = result ? finishOffsetToDate(cal, status.dataDate, result.originalFinish) : null;

  const savePlan = () => {
    if (!result || !newFinish) return;
    const plan: RecoveryPlanRecord = {
      id: newId(),
      forecastId: forecast.record.id,
      status: "draft",
      budgetPkr: budget.trim() ? Number(budget.replace(/[,\s]/g, "")) : undefined,
      targetFinish: target,
      newFinish,
      totalCostPkr: result.totalCostPkr,
      meetsTarget: result.meetsTarget,
      actions: result.actions,
      createdAt: new Date().toISOString(),
    };
    setSaved(save((b) => ({ ...b, recoveryPlans: [...b.recoveryPlans, plan] })));
  };

  if (done) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-ink-2">This project is finished, so there is nothing left to recover.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-6 sm:px-6">
      <Section title="Cheapest way back" aside={`Remaining work finishes ${fmtDate(status.forecastFinish)} at the planned pace`}>
        <p className="max-w-prose text-sm leading-6 text-ink-2">
          Revive tries two speed-ups on every remaining activity, overtime and an extra crew, and uses a linear
          programme (HiGHS) to find the cheapest mix that brings the finish back to your target, keeping every link in
          the schedule.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Target finish" htmlFor="target" hint={`Contract completion is ${fmtDate(status.targetDate)}`}>
            <input id="target" type="date" className="control" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Budget (PKR)" htmlFor="budget" hint={budget ? pkr(Number(budget.replace(/[,\s]/g, ""))) : "Optional: leave blank for no limit"}>
            <input id="budget" inputMode="decimal" className="control" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>
          <Field
            label="Value of one working day (PKR)"
            htmlFor="rate"
            hint={rate ? `${pkr(Number(rate.replace(/[,\s]/g, "")))} · contract value spread over the programme` : "Contract value ÷ working days"}
          >
            <input id="rate" inputMode="decimal" className="control" value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? "Solving…" : "Find the cheapest plan"}
          </Button>
          {error ? <p className="text-sm text-risk">{error}</p> : null}
        </div>
        <div className="mt-4">
          <LearningNote>
            Speed-up presets until they are calibrated: overtime saves up to {OVERTIME_MAX_SHARE * 100}% of an
            activity&apos;s remaining time at {OVERTIME_RATE_MULTIPLIER}× the daily value per day saved; an extra crew a
            further {EXTRA_CREW_MAX_SHARE * 100}% at {EXTRA_CREW_RATE_MULTIPLIER}×.
          </LearningNote>
        </div>
      </Section>

      {result && newFinish && oldFinish ? (
        <Section
          title={result.meetsTarget ? "Plan that meets the target" : "The target can't be met; fastest plan instead"}
          aside={<Badge tone={result.meetsTarget ? "ok" : "risk"}>{result.meetsTarget ? "meets target" : "misses target"}</Badge>}
        >
          <dl className="grid gap-px overflow-hidden rounded-[6px] border border-rule bg-rule text-sm sm:grid-cols-3">
            <div className="bg-sheet p-4">
              <dt className="text-ink-2">New finish</dt>
              <dd className="mt-1 text-2xl font-semibold">{fmtDate(newFinish)}</dd>
              <dd className="text-xs text-ink-2">was {fmtDate(oldFinish)}</dd>
            </div>
            <div className="bg-sheet p-4">
              <dt className="text-ink-2">Working days saved</dt>
              <dd className="mt-1 text-2xl font-semibold">{(result.originalFinish - result.newFinish).toFixed(1)}</dd>
              <dd className="text-xs text-ink-2">target {fmtDate(target)}</dd>
            </div>
            <div className="bg-sheet p-4">
              <dt className="text-ink-2">Cost</dt>
              <dd className="mt-1 text-2xl font-semibold">{pkr(result.totalCostPkr)}</dd>
              <dd className="text-xs text-ink-2">{result.actions.length} speed-ups</dd>
            </div>
          </dl>
          {result.actions.length ? (
            <div className="mt-5 overflow-x-auto border-y border-rule">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-panel text-left text-xs text-ink-2">
                    <th className="px-3 py-2 font-medium">Activity</th>
                    <th className="px-3 py-2 font-medium">Speed-up</th>
                    <th className="px-3 py-2 text-right font-medium">Days saved</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {result.actions.map((a) => (
                    <tr key={`${a.activityId}:${a.optionId}`}>
                      <td className="px-3 py-2">
                        <span className="mr-2 font-mono text-[0.8125rem] text-ink-2">{names.get(a.activityId)?.code}</span>
                        {names.get(a.activityId)?.name ?? a.activityId}
                      </td>
                      <td className="px-3 py-2">{a.label}</td>
                      <td className="px-3 py-2 text-right">{a.daysSaved.toFixed(1)}</td>
                      <td className="px-3 py-2 text-right">{pkr(a.costPkr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-2">The remaining work already meets the target at the planned pace; no speed-up needed.</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button onClick={savePlan} disabled={saved}>
              {saved ? "Saved to this project" : "Save this plan"}
            </Button>
            <p className="text-xs text-ink-2">Uses the planned pace of remaining work; the forecast range around it still applies.</p>
          </div>
        </Section>
      ) : null}

      {bundle.recoveryPlans.length ? (
        <Section title="Saved plans">
          <ul className="divide-y divide-rule border-y border-rule text-sm">
            {[...bundle.recoveryPlans].reverse().map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <span>
                  {fmtDate(p.createdAt.slice(0, 10))}: finish {fmtDate(p.newFinish)} for {pkr(p.totalCostPkr)} ({p.actions.length} speed-ups)
                </span>
                <Badge tone={p.meetsTarget ? "ok" : "warn"}>{p.meetsTarget ? `meets ${fmtDate(p.targetFinish)}` : `short of ${fmtDate(p.targetFinish)}`}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </main>
  );
}
