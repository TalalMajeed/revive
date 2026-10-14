"use client";

import { useMemo, useState } from "react";
import { useProjectData } from "@/components/project-context";
import { Badge, OwnerTag, Section } from "@/components/ui";
import { fmtDate, pkr } from "@/lib/format";
import { RISK_GROUP_LABEL, eventEvidence, lostDaysByGroup, paymentEvidence, type RiskGroup } from "@/lib/progress/evidence";
import { CATEGORY_LABEL } from "@/lib/progress/reasons";

const GROUPS: RiskGroup[] = ["employer", "neutral", "contractor"];

export default function CausesPage() {
  const { bundle, forecast } = useProjectData();
  const asOf = forecast.status.dataDate;
  const [filter, setFilter] = useState<RiskGroup | "all">("all");
  const lost = useMemo(() => lostDaysByGroup(bundle, asOf), [bundle, asOf]);
  const events = useMemo(() => eventEvidence(bundle, asOf), [bundle, asOf]);
  const payments = useMemo(() => paymentEvidence(bundle, asOf), [bundle, asOf]);
  const total = GROUPS.reduce((s, g) => s + lost[g], 0);
  const shown = filter === "all" ? events : events.filter((e) => e.group === filter);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-6 sm:px-6">
      <Section title="Who the lost days belong to" aside="From the slip reasons in every weekly update">
        <div className="grid gap-px overflow-hidden rounded-[6px] border border-rule bg-rule sm:grid-cols-3">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setFilter((f) => (f === g ? "all" : g))}
              aria-pressed={filter === g}
              className={`bg-sheet p-4 text-left transition-colors hover:bg-paper ${filter === g ? "outline-2 -outline-offset-2 outline-ink" : ""}`}
            >
              <p className="text-sm text-ink-2">{RISK_GROUP_LABEL[g].title}</p>
              <p className={`mt-1 text-3xl font-semibold tracking-tight ${g === "employer" ? "text-ink" : "text-ink-2"}`}>
                {Math.round(lost[g])}
                <span className="ml-1 text-sm font-normal text-ink-2">days</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
                <span className={`block h-full ${g === "employer" ? "bg-ink" : "bg-ink-3"}`} style={{ width: `${total ? (100 * lost[g]) / total : 0}%` }} />
              </div>
              <p className="mt-2 text-xs leading-5 text-ink-2">{RISK_GROUP_LABEL[g].note}</p>
            </button>
          ))}
        </div>
      </Section>

      <Section
        title="Cause log"
        aside={filter === "all" ? `${events.length} dated records` : `${shown.length} of ${events.length}, ${RISK_GROUP_LABEL[filter].title.toLowerCase()}`}
      >
        {shown.length === 0 ? (
          <p className="text-sm text-ink-2">No events recorded yet. Add them in the weekly update: an RFI, a site instruction, rain, a shortage.</p>
        ) : (
          <div className="overflow-x-auto border-y border-rule">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="bg-panel text-left text-xs text-ink-2">
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">What happened</th>
                  <th className="px-3 py-2 font-medium">Cause</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Work affected</th>
                  <th className="px-3 py-2 text-right font-medium">Days</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {shown.map(({ event: e, activityName, criticalAtTheTime, daysOpen }) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2.5">{fmtDate(e.eventDate)}</td>
                    <td className="px-3 py-2.5">
                      {e.reference ? <span className="mr-1.5 font-mono text-[0.8125rem] text-ink-2">{e.reference}</span> : null}
                      {e.description}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">{CATEGORY_LABEL[e.category]}</td>
                    <td className="px-3 py-2.5">
                      <OwnerTag owner={e.responsibleParty} />
                    </td>
                    <td className="px-3 py-2.5">
                      {activityName ?? <span className="text-ink-2">—</span>}
                      {criticalAtTheTime ? <Badge tone="risk" className="ml-1.5">critical then</Badge> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right">{e.daysLost ?? (daysOpen !== undefined ? daysOpen : "—")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      {e.category === "weather" ? (
                        <span className="text-ink-2">recorded</span>
                      ) : e.resolvedOn && e.resolvedOn <= asOf ? (
                        <span className="text-ink-2">closed {fmtDate(e.resolvedOn)}</span>
                      ) : (
                        <Badge tone="warn">open {daysOpen} days</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink-2">Days: days lost where recorded, otherwise days the issue was open.</p>
      </Section>

      <Section title="Interim payment certificates" aside={`Due ${30} days after certification unless the contract says otherwise`}>
        {payments.length === 0 ? (
          <p className="text-sm text-ink-2">No IPCs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto border-y border-rule">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-panel text-left text-xs text-ink-2">
                  <th className="px-3 py-2 font-medium">IPC</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Submitted</th>
                  <th className="px-3 py-2 font-medium">Certified</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Days late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {payments.map((p) => (
                  <tr key={p.ipcNumber}>
                    <td className="px-3 py-2 font-mono text-[0.8125rem]">IPC {p.ipcNumber}</td>
                    <td className="px-3 py-2 text-right">{pkr(p.amountPkr)}</td>
                    <td className="px-3 py-2">{fmtDate(p.submittedOn)}</td>
                    <td className="px-3 py-2">{fmtDate(p.certifiedOn)}</td>
                    <td className="px-3 py-2">{fmtDate(p.dueOn)}</td>
                    <td className="px-3 py-2">{p.paidOn ? fmtDate(p.paidOn) : p.certifiedOn ? <Badge tone={p.daysLate > 0 ? "risk" : "neutral"}>unpaid</Badge> : "—"}</td>
                    <td className={`px-3 py-2 text-right ${p.daysLate > 0 ? "font-medium text-risk" : "text-ink-2"}`}>{p.daysLate > 0 ? p.daysLate : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </main>
  );
}
