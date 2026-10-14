"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Button, LinkButton, OwnerTag, Skeleton, healthLabel, healthTone } from "@/components/ui";
import { deleteProject, saveProject, useProjects } from "@/lib/data/store";
import type { ForecastRecord, ProjectBundle } from "@/lib/data/types";
import { DEMO_IDS, buildDemoBundles } from "@/lib/demo";
import { fmtDate, pct } from "@/lib/format";
import { forecastWeek } from "@/lib/progress/forecast";
import { sortedUpdates } from "@/lib/progress/state";

interface Row {
  bundle: ProjectBundle;
  forecast: ForecastRecord;
}

/** The logged forecast for the latest week, or a fresh one if it isn't logged. */
function latestForecast(bundle: ProjectBundle): ForecastRecord {
  const updates = sortedUpdates(bundle);
  const last = updates[updates.length - 1];
  const logged = last && bundle.forecasts.find((f) => f.asOf === last.dataDate);
  return logged ?? forecastWeek(bundle, undefined, { iterations: 1000 }).record;
}

export default function Portfolio() {
  const projects = useProjects();
  const [loadingDemo, setLoadingDemo] = useState(false);

  const rows = useMemo<Row[] | null>(
    () => projects?.map((bundle) => ({ bundle, forecast: latestForecast(bundle) })) ?? null,
    [projects],
  );

  const loadDemo = () => {
    setLoadingDemo(true);
    // Let the button state paint before the simulations run.
    setTimeout(() => {
      for (const b of buildDemoBundles()) saveProject(b);
      setLoadingDemo(false);
    }, 30);
  };

  const removeDemo = () => DEMO_IDS.forEach((id) => deleteProject(id));

  const active = rows?.filter((r) => r.bundle.project.status !== "completed").sort((a, b) => a.forecast.healthScore - b.forecast.healthScore);
  const finished = rows?.filter((r) => r.bundle.project.status === "completed");
  const hasDemo = !!projects?.some((b) => b.project.isDemo);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-ink-2">
            {active && active.length > 0
              ? `${active.length} live, riskiest first. Forecasts as of each project's last weekly update.`
              : "Every Monday: which project is slipping, why, and what to do this week."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasDemo ? (
            <Button variant="ghost" onClick={removeDemo}>
              Remove demo projects
            </Button>
          ) : (
            <Button onClick={loadDemo} disabled={loadingDemo || rows === null}>
              {loadingDemo ? "Running demo forecasts…" : "Load demo projects"}
            </Button>
          )}
          <LinkButton href="/projects/new" variant="primary">
            Set up a project
          </LinkButton>
        </div>
      </div>

      {rows === null ? (
        <div className="mt-8 space-y-2" aria-busy="true">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : rows.length === 0 ? (
        <Empty onLoadDemo={loadDemo} loading={loadingDemo} />
      ) : (
        <>
          {active && active.length > 0 ? <ProjectTable rows={active} /> : null}
          {finished && finished.length > 0 ? (
            <section className="mt-10">
              <h2 className="text-base font-semibold">Finished projects</h2>
              <p className="mt-1 text-sm text-ink-2">
                Replay a finished project week by week to see when Revive would first have warned.
              </p>
              <ul className="mt-4 divide-y divide-rule border-y border-rule">
                {finished.map(({ bundle }) => {
                  const p = bundle.project;
                  const contract = p.setup.original_completion_date;
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link href={`/projects/${encodeURIComponent(p.id)}`} className="font-medium text-ink hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-sm text-ink-2">
                          Contract completion {fmtDate(contract)} · finished {fmtDate(p.actualCompletionDate)}
                          {p.isDemo ? " · demo" : ""}
                        </p>
                      </div>
                      <LinkButton href={`/projects/${encodeURIComponent(p.id)}/replay`}>Replay</LinkButton>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}

function ProjectTable({ rows }: { rows: Row[] }) {
  return (
    <>
      <ul className="mt-6 divide-y divide-rule border-y border-rule sm:hidden">
        {rows.map(({ bundle, forecast }) => {
          const p = bundle.project;
          const reason = forecast.reasons[0];
          return (
            <li key={p.id}>
              <Link href={`/projects/${encodeURIComponent(p.id)}`} className="block py-3 text-ink no-underline">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium leading-6">{p.name}</span>
                  <span className={`text-lg font-semibold ${forecast.probabilityLate >= 0.5 ? "text-risk" : ""}`}>{pct(forecast.probabilityLate)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                  <Badge tone={healthTone(forecast.healthScore)}>
                    {forecast.healthScore} · {healthLabel(forecast.healthScore)}
                  </Badge>
                  <span>likely {fmtDate(forecast.p50)}</span>
                </div>
                {reason ? <p className="mt-1.5 text-sm text-ink-2">{reason.title}</p> : null}
              </Link>
            </li>
          );
        })}
      </ul>
      <ProjectTableWide rows={rows} />
    </>
  );
}

function ProjectTableWide({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-6 hidden overflow-x-auto border-y border-rule sm:block">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="bg-panel text-left text-xs font-medium text-ink-2">
            <th className="w-28 px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium">Project</th>
            <th className="w-28 px-3 py-2 text-right font-medium">Chance late</th>
            <th className="w-44 px-3 py-2 font-medium">Likely finish (P50)</th>
            <th className="px-3 py-2 font-medium">Main reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map(({ bundle, forecast }) => {
            const p = bundle.project;
            const href = `/projects/${encodeURIComponent(p.id)}`;
            const late = forecast.p50 > forecast.targetDate;
            const reason = forecast.reasons[0];
            return (
              <tr key={p.id} className="group align-top transition-colors hover:bg-sheet">
                <td className="px-3 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-semibold leading-none">{forecast.healthScore}</span>
                    <Badge tone={healthTone(forecast.healthScore)}>{healthLabel(forecast.healthScore)}</Badge>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <Link href={href} className="font-medium text-ink hover:underline">
                    {p.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-2">
                    {[p.location, `updated ${fmtDate(forecast.asOf)}`, p.isDemo ? "demo" : null].filter(Boolean).join(" · ")}
                  </p>
                </td>
                <td className={`px-3 py-3 text-right text-base font-semibold ${forecast.probabilityLate >= 0.5 ? "text-risk" : ""}`}>
                  {pct(forecast.probabilityLate)}
                </td>
                <td className="px-3 py-3">
                  <span className={late ? "font-medium text-risk" : ""}>{fmtDate(forecast.p50)}</span>
                  <p className="mt-0.5 text-xs text-ink-2">contract {fmtDate(forecast.targetDate)}</p>
                </td>
                <td className="px-3 py-3">
                  {reason ? (
                    <div className="flex items-start gap-2">
                      <OwnerTag owner={reason.owner} />
                      <span className="text-ink-2">{reason.title}</span>
                    </div>
                  ) : (
                    <span className="text-ink-2">No warning signs this week</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ onLoadDemo, loading }: { onLoadDemo: () => void; loading: boolean }) {
  return (
    <div className="mt-10 grid gap-10 border-t border-rule pt-8 md:grid-cols-[1.2fr_1fr]">
      <div>
        <h2 className="text-lg font-semibold">No projects yet</h2>
        <p className="mt-2 max-w-prose leading-7 text-ink-2">
          Set up a project once: answer twelve questions about the contract and upload the programme as a Primavera
          P6 <span className="font-mono text-[0.8125rem]">.xer</span> or MS Project{" "}
          <span className="font-mono text-[0.8125rem]">.xml</span> file. After that, a two-minute update each week
          gives you the chance of finishing late, the likely finish range, the reasons with who owns them, and a
          dated cause log for extension-of-time claims.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <LinkButton href="/projects/new" variant="primary">
            Set up a project
          </LinkButton>
          <Button onClick={onLoadDemo} disabled={loading}>
            {loading ? "Running demo forecasts…" : "Load demo projects"}
          </Button>
        </div>
      </div>
      <div className="text-sm leading-6 text-ink-2">
        <h3 className="font-medium text-ink">The demo has three projects</h3>
        <ul className="mt-2 space-y-2">
          <li>A road in Bahawalpur that is slipping: utility shifting at culverts, unpaid IPCs, monsoon.</li>
          <li>A private clinic in Lahore that is on track.</li>
          <li>A finished school block in Multan, to replay week by week and see when the warning came.</li>
        </ul>
        <p className="mt-3">
          They are illustrative, not real projects. Everything is saved in this browser only.
        </p>
      </div>
    </div>
  );
}
