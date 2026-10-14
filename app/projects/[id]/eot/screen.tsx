"use client";

import { useMemo } from "react";
import { useProjectData } from "@/components/project-context";
import { Button, LearningNote } from "@/components/ui";
import { CLIENT_TYPE_LABELS, FUNDING_SOURCE_LABELS } from "@/lib/forecast/award";
import { days, fmtDate, pkr } from "@/lib/format";
import { RISK_GROUP_LABEL, eventEvidence, lostDaysByGroup, paymentEvidence } from "@/lib/progress/evidence";
import { CATEGORY_LABEL, OWNER_LABEL } from "@/lib/progress/reasons";
import { daysBetween } from "@/lib/progress/signals";

export default function EotPack() {
  const { bundle, forecast } = useProjectData();
  const { status, record } = forecast;
  const p = bundle.project;
  const asOf = status.dataDate;
  const done = p.status === "completed";
  const finish = done ? p.actualCompletionDate! : record.p50;
  const lost = useMemo(() => lostDaysByGroup(bundle, asOf), [bundle, asOf]);
  const events = useMemo(() => eventEvidence(bundle, asOf), [bundle, asOf]);
  const payments = useMemo(() => paymentEvidence(bundle, asOf), [bundle, asOf]);
  const employerEvents = events.filter((e) => e.group !== "contractor");
  const latePayments = payments.filter((x) => x.daysLate > 0);
  const delayCalendar = Math.max(0, daysBetween(status.targetDate, finish));
  const claimable = Math.round(lost.employer + lost.neutral);
  const updates = bundle.updates.length;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 print:max-w-none print:p-0">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">A dated record built from the weekly updates. Print it or save it as a PDF.</p>
        <Button variant="primary" onClick={() => window.print()}>
          Print or save as PDF
        </Button>
      </div>

      <article className="rounded-[6px] border border-rule bg-sheet px-6 py-8 text-[0.9375rem] leading-7 sm:px-10 print:border-0 print:p-0">
        <header className="border-b-2 border-ink pb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Evidence for extension of time</h1>
          <p className="mt-1 text-balance font-medium">{p.name}</p>
          <p className="mt-1 text-sm text-ink-2">
            {[p.code ? `Contract ${p.code}` : null, p.location, `Records to ${fmtDate(asOf)}`].filter(Boolean).join(" · ")}
          </p>
        </header>

        <h2 className="mt-7 text-base font-semibold">1. Particulars</h2>
        <dl className="mt-2 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <Row term="Client">{p.setup.client_type ? CLIENT_TYPE_LABELS[p.setup.client_type] : "—"}</Row>
          <Row term="Funding">{p.setup.funding_source ? FUNDING_SOURCE_LABELS[p.setup.funding_source] : "—"}</Row>
          <Row term="Contract value">{pkr(p.setup.contract_value_pkr)}</Row>
          <Row term="Commencement">{fmtDate(p.setup.contract_start_date)}</Row>
          <Row term="Original completion">{fmtDate(status.targetDate)}</Row>
          <Row term={done ? "Actual completion" : "Forecast completion (P50)"}>{fmtDate(finish)}</Row>
          <Row term="Delay to completion">{delayCalendar > 0 ? `${days(delayCalendar)} (calendar)` : "None"}</Row>
          <Row term="Contemporaneous records">{updates} weekly updates, {events.length} dated events</Row>
        </dl>

        <h2 className="mt-7 text-base font-semibold">2. Summary</h2>
        <p className="mt-2 max-w-[70ch]">
          The weekly records attribute <strong>{Math.round(lost.employer)} days</strong> of lost progress to events at
          the Employer&apos;s risk (client, consultant and authorities) and <strong>{Math.round(lost.neutral)} days</strong>{" "}
          to neutral events such as weather, against {Math.round(lost.contractor)} days at the Contractor&apos;s own risk.
          {latePayments.length
            ? ` ${latePayments.length} interim payment certificate${latePayments.length > 1 ? "s were" : " was"} paid late or remain${latePayments.length > 1 ? "" : "s"} unpaid past the due date.`
            : ""}{" "}
          On these records an extension of up to {claimable} working days is supported, subject to the critical-path
          analysis below and the Engineer&apos;s assessment under the contract.
        </p>
        <dl className="mt-4 grid gap-px overflow-hidden rounded-[4px] border border-rule bg-rule text-sm sm:grid-cols-3">
          {(["employer", "neutral", "contractor"] as const).map((g) => (
            <div key={g} className="bg-sheet p-3">
              <dt className="text-ink-2">{RISK_GROUP_LABEL[g].title}</dt>
              <dd className="text-xl font-semibold">{Math.round(lost[g])} days</dd>
            </div>
          ))}
        </dl>

        <h2 className="mt-7 text-base font-semibold">3. Delay events</h2>
        <p className="mt-1 text-sm text-ink-2">Events at the Employer&apos;s risk and neutral events, in date order.</p>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink text-left text-xs">
              <th className="py-1.5 pr-3 font-medium">Date</th>
              <th className="py-1.5 pr-3 font-medium">Reference</th>
              <th className="py-1.5 pr-3 font-medium">Event</th>
              <th className="py-1.5 pr-3 font-medium">Responsible</th>
              <th className="py-1.5 pr-3 font-medium">Critical?</th>
              <th className="py-1.5 text-right font-medium">Days</th>
            </tr>
          </thead>
          <tbody>
            {employerEvents.map(({ event: e, activityName, criticalAtTheTime, daysOpen }) => (
              <tr key={e.id} className="border-b border-rule align-top">
                <td className="whitespace-nowrap py-2 pr-3">{fmtDate(e.eventDate)}</td>
                <td className="py-2 pr-3 font-mono text-[0.8125rem]">{e.reference ?? "—"}</td>
                <td className="py-2 pr-3">
                  {CATEGORY_LABEL[e.category]}: {e.description}
                  {activityName ? <span className="block text-xs text-ink-2">Affecting {activityName}</span> : null}
                </td>
                <td className="py-2 pr-3">{OWNER_LABEL[e.responsibleParty]}</td>
                <td className="py-2 pr-3">{criticalAtTheTime === undefined ? "—" : criticalAtTheTime ? "Yes" : "No"}</td>
                <td className="py-2 text-right">{e.daysLost ?? daysOpen ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-ink-2">
          Critical: whether the affected activity had no float in the weekly update before the event. Days: days lost
          where recorded, otherwise days the matter stayed open.
        </p>

        <h2 className="mt-7 text-base font-semibold">4. Payments</h2>
        {latePayments.length ? (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink text-left text-xs">
                <th className="py-1.5 pr-3 font-medium">IPC</th>
                <th className="py-1.5 pr-3 font-medium">Certified</th>
                <th className="py-1.5 pr-3 font-medium">Due</th>
                <th className="py-1.5 pr-3 font-medium">Paid</th>
                <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                <th className="py-1.5 text-right font-medium">Days late</th>
              </tr>
            </thead>
            <tbody>
              {latePayments.map((x) => (
                <tr key={x.ipcNumber} className="border-b border-rule">
                  <td className="py-2 pr-3">IPC {x.ipcNumber}</td>
                  <td className="py-2 pr-3">{fmtDate(x.certifiedOn)}</td>
                  <td className="py-2 pr-3">{fmtDate(x.dueOn)}</td>
                  <td className="py-2 pr-3">{x.paidOn ? fmtDate(x.paidOn) : "Unpaid"}</td>
                  <td className="py-2 pr-3 text-right">{pkr(x.amountPkr)}</td>
                  <td className="py-2 text-right">{x.daysLate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm">All certified payments were made by their due dates.</p>
        )}

        <h2 className="mt-7 text-base font-semibold">5. Basis</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Each week&apos;s progress, causes and owners were recorded in Revive on or near the data date shown.</li>
          <li>Critical-path status comes from the contractor&apos;s programme ({p.scheduleSource === "xer" ? "Primavera P6" : p.scheduleSource === "mspdi" ? "MS Project" : "baseline"}) updated with that week&apos;s progress.</li>
          <li>Payment due dates are {30} days after certification where the contract date was not entered.</li>
        </ul>
        <div className="mt-6 no-print">
          <LearningNote>
            This pack organises the evidence; it does not decide entitlement. Check the notice periods and clauses of
            your contract before submitting.
          </LearningNote>
        </div>
      </article>
    </main>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-1.5">
      <dt className="text-ink-2">{term}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}
