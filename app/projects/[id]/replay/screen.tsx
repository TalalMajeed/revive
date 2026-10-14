"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ForecastTrend } from "@/components/charts/trend";
import { useProjectData } from "@/components/project-context";
import { Badge, Button, OwnerTag, Section, healthLabel, healthTone } from "@/components/ui";
import type { ForecastRecord } from "@/lib/data/types";
import { fmtDate, pct } from "@/lib/format";
import { forecastWeek } from "@/lib/progress/forecast";
import { daysBetween } from "@/lib/progress/signals";
import { sortedUpdates } from "@/lib/progress/state";

/** A warning counts once the chance of finishing late reaches this. */
const WARNING_LEVEL = 0.5;

export default function Replay() {
  const { bundle, forecast } = useProjectData();
  const target = forecast.status.targetDate;
  const actualFinish = bundle.project.actualCompletionDate;

  // One forecast per weekly update: the logged one, or rerun if missing.
  const log = useMemo<ForecastRecord[]>(() => {
    const byDate = new Map(bundle.forecasts.map((f) => [f.asOf, f]));
    return sortedUpdates(bundle).map((u, i) => byDate.get(u.dataDate) ?? forecastWeek(bundle, i, { iterations: 1000 }).record);
  }, [bundle]);

  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setI((k) => {
        if (k >= log.length - 1) {
          setPlaying(false);
          return k;
        }
        return k + 1;
      });
    }, 350);
    return () => clearInterval(t);
  }, [playing, log.length]);

  if (log.length < 2) {
    return (
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <h2 className="text-lg font-semibold">Not enough weeks to replay yet</h2>
        <p className="mt-2 max-w-prose text-ink-2">
          Replay steps through the weekly forecasts. It needs at least two weekly updates; finished projects are the
          real test, because the actual finish shows whether the warning was right.
        </p>
      </main>
    );
  }

  const firstWarning = log.findIndex((f) => f.probabilityLate >= WARNING_LEVEL);
  const warn = firstWarning >= 0 ? log[firstWarning] : undefined;
  const sel = log[Math.min(i, log.length - 1)];
  const weeksBefore = (date: string) => Math.round(daysBetween(warn!.asOf, date) / 7);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6">
      <div className="rounded-[6px] border border-rule bg-sheet p-5">
        {warn ? (
          <p className="max-w-[70ch] text-lg leading-8">
            Revive would first have warned on <strong>{fmtDate(warn.asOf)}</strong>, with a {pct(warn.probabilityLate)} chance
            of finishing late:{" "}
            <strong className="text-risk">{weeksBefore(target)} weeks before the contract completion date</strong>
            {actualFinish ? (
              <>
                {" "}and {weeksBefore(actualFinish)} weeks before the project actually finished ({fmtDate(actualFinish)}).
              </>
            ) : (
              "."
            )}
          </p>
        ) : (
          <p className="text-lg leading-8">
            The chance of finishing late never reached {pct(WARNING_LEVEL)} in {log.length} weeks
            {actualFinish ? `; the project finished on ${fmtDate(actualFinish)}` : ""}.
          </p>
        )}
        <p className="mt-2 text-sm text-ink-2">
          Each week uses only what was known that Monday: the progress, payments and events recorded up to then.
        </p>
      </div>

      <Section
        title="Week by week"
        aside={
          <div className="flex items-center gap-2">
            <Button onClick={() => setI((k) => Math.max(0, k - 1))} aria-label="Previous week" disabled={i === 0}>
              <ChevronLeft size={16} strokeWidth={1.75} />
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (i >= log.length - 1) setI(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "Pause" : i >= log.length - 1 ? "Replay from start" : "Play"}
            </Button>
            <Button onClick={() => setI((k) => Math.min(log.length - 1, k + 1))} aria-label="Next week" disabled={i >= log.length - 1}>
              <ChevronRight size={16} strokeWidth={1.75} />
            </Button>
          </div>
        }
      >
        <input
          type="range"
          min={0}
          max={log.length - 1}
          value={i}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          className="w-full"
          aria-label="Week"
        />
        <div className="mt-4">
          <ForecastTrend
            forecasts={log}
            target={target}
            actualFinish={actualFinish}
            selected={i}
            onSelect={(k) => {
              setPlaying(false);
              setI(k);
            }}
            firstWarning={firstWarning >= 0 ? firstWarning : undefined}
          />
        </div>
      </Section>

      <Section title={`Monday ${fmtDate(sel.asOf)}`} aside={`Week ${i + 1} of ${log.length}`}>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[18rem_1fr]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm lg:grid-cols-1">
            <div>
              <dt className="text-ink-2">Health</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl font-semibold">{sel.healthScore}</span>
                <Badge tone={healthTone(sel.healthScore)}>{healthLabel(sel.healthScore)}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">Chance of finishing late</dt>
              <dd className={`mt-1 text-3xl font-semibold ${sel.probabilityLate >= WARNING_LEVEL ? "text-risk" : ""}`}>{pct(sel.probabilityLate)}</dd>
            </div>
            <div className="col-span-2 lg:col-span-1">
              <dt className="text-ink-2">Likely finish</dt>
              <dd className="mt-1 font-medium">
                {fmtDate(sel.p50)} <span className="font-normal text-ink-2">(80%: {fmtDate(sel.p10)} – {fmtDate(sel.p90)})</span>
              </dd>
            </div>
          </dl>
          <div>
            <h3 className="text-sm font-medium text-ink-2">What Revive said that week</h3>
            {sel.reasons.length ? (
              <ol className="mt-3 space-y-3">
                {sel.reasons.slice(0, 4).map((r) => (
                  <li key={r.key} className="border-b border-rule pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-medium">{r.title}</span>
                      <OwnerTag owner={r.owner} />
                    </div>
                    <p className="mt-1 text-sm text-ink-2">{r.action}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-ink-2">No warning signs that week.</p>
            )}
          </div>
        </div>
      </Section>
    </main>
  );
}
