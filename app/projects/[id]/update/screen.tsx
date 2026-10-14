"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useProjectData } from "@/components/project-context";
import { Badge, Button, Field, OwnerTag } from "@/components/ui";
import { newId } from "@/lib/data/store";
import {
  DELAY_CATEGORIES,
  RESPONSIBLE_PARTIES,
  type ActivityProgress,
  type DelayCategory,
  type Payment,
  type ProjectBundle,
  type ResponsibleParty,
  type SlipReason,
  type WeeklyEvent,
} from "@/lib/data/types";
import { fmtDate, fmtDay, pkr } from "@/lib/format";
import { forecastWeek } from "@/lib/progress/forecast";
import { CATEGORY_LABEL, OWNER_LABEL } from "@/lib/progress/reasons";
import { calendarOf, sortedUpdates } from "@/lib/progress/state";
import { addCalendarDays, countWorkingDays, parseIsoDate } from "@/lib/schedule";

const DEFAULT_PARTY: Record<DelayCategory, ResponsibleParty> = {
  design_query: "consultant",
  drawing_delay: "consultant",
  variation_order: "client",
  payment_delay: "client",
  site_access: "client",
  material_shortage: "supplier",
  crew_shortage: "contractor",
  equipment_breakdown: "contractor",
  weather: "none",
  utility_shifting: "authority",
  law_and_order: "none",
  other: "contractor",
};

function mondayOnOrAfter(date: string): string {
  const dow = new Date(parseIsoDate(date)).getUTCDay();
  return addCalendarDays(date, (8 - dow) % 7);
}

interface Row {
  pct: number;
  why?: DelayCategory;
  party?: ResponsibleParty;
}

interface NewEvent {
  key: string;
  eventDate: string;
  category: DelayCategory;
  responsibleParty: ResponsibleParty;
  description: string;
  reference: string;
  daysLost: string;
  activityId: string;
}

export default function WeeklyUpdate() {
  const router = useRouter();
  const { bundle, forecast, save } = useProjectData();
  const { status } = forecast;
  const cal = calendarOf(bundle);
  const updates = sortedUpdates(bundle);
  const last = updates[updates.length - 1];
  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = last ? addCalendarDays(last.dataDate, 7) : mondayOnOrAfter(today);

  const [dataDate, setDataDate] = useState(defaultDate);
  const [showAll, setShowAll] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [paymentEdits, setPaymentEdits] = useState<Record<string, Partial<Payment>>>({});
  const [newIpc, setNewIpc] = useState<{ submittedOn: string; amount: string } | null>(null);
  const [events, setEvents] = useState<NewEvent[]>([]);
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const start = bundle.project.scheduleStart;
  const plannedPct = (bs: string, bf: string) => {
    const t = countWorkingDays(cal, start, dataDate) - 1;
    const s = countWorkingDays(cal, start, bs) - 1;
    const f = countWorkingDays(cal, start, bf);
    return Math.round(100 * Math.min(1, Math.max(0, (t - s) / Math.max(f - s, 1))));
  };

  const candidates = useMemo(() => {
    const soon = addCalendarDays(dataDate, 21);
    return status.activities.filter(
      (a) => !a.isMilestone && a.status !== "complete" && (showAll || a.status === "in_progress" || a.start <= soon || a.baselineStart <= dataDate),
    );
  }, [status.activities, dataDate, showAll]);

  const openIssues = bundle.events.filter((e) => !e.resolvedOn && e.category !== "weather");
  const unpaid = bundle.payments.filter((p) => !p.paidOn).sort((a, b) => a.ipcNumber - b.ipcNumber);

  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...(r[id] ?? { pct: current(id) }), ...patch } }));
  const current = (id: string) => status.state.activities.find((s) => s.activity.id === id)?.percentComplete ?? 0;

  const submit = () => {
    setError(null);
    if (last && dataDate <= last.dataDate) {
      setError(`The data date must be after the last update (${fmtDate(last.dataDate)}).`);
      return;
    }
    if (dataDate > addCalendarDays(today, 7)) {
      setError("The data date can't be more than a week ahead.");
      return;
    }
    setSaving(true);
    const updateId = `u-${newId()}`;
    const weekStart = addCalendarDays(dataDate, -7);
    const progress: ActivityProgress[] = [];
    const reasons: SlipReason[] = [];
    for (const [id, row] of Object.entries(rows)) {
      const prev = status.state.activities.find((s) => s.activity.id === id)!;
      if (row.pct !== prev.percentComplete) {
        progress.push({
          activityId: id,
          percentComplete: row.pct,
          actualStart: prev.actualStart ?? (row.pct > 0 ? weekStart : undefined),
          actualFinish: row.pct >= 100 ? addCalendarDays(dataDate, -1) : undefined,
        });
      }
      if (row.why) {
        reasons.push({
          id: `${updateId}:${id}`,
          updateId,
          activityId: id,
          category: row.why,
          responsibleParty: row.party ?? DEFAULT_PARTY[row.why],
        });
      }
    }
    const addedEvents: WeeklyEvent[] = events
      .filter((e) => e.description.trim())
      .map((e) => ({
        id: newId(),
        updateId,
        eventDate: e.eventDate,
        category: e.category,
        responsibleParty: e.responsibleParty,
        description: e.description.trim(),
        reference: e.reference.trim() || undefined,
        daysLost: e.daysLost ? Number(e.daysLost) : undefined,
        activityId: e.activityId || undefined,
      }));

    const change = (b: ProjectBundle): ProjectBundle => {
      const payments = b.payments.map((p) => ({ ...p, ...paymentEdits[p.id] }));
      if (newIpc?.submittedOn) {
        const n = Math.max(0, ...b.payments.map((p) => p.ipcNumber)) + 1;
        const amount = Number(newIpc.amount.replace(/[,\s]/g, ""));
        payments.push({ id: newId(), ipcNumber: n, submittedOn: newIpc.submittedOn, amountClaimedPkr: Number.isFinite(amount) && amount > 0 ? amount : undefined });
      }
      const next: ProjectBundle = {
        ...b,
        updates: [...b.updates, { id: updateId, weekStart, dataDate, activities: progress, notes: notes.trim() || undefined, createdAt: new Date().toISOString() }],
        slipReasons: [...b.slipReasons, ...reasons],
        payments,
        events: [...b.events.map((e) => (resolved.has(e.id) ? { ...e, resolvedOn: dataDate } : e)), ...addedEvents],
      };
      const record = forecastWeek(next).record;
      return { ...next, forecasts: [...next.forecasts.filter((f) => f.asOf !== record.asOf), record] };
    };
    if (!save(change)) {
      setError("This browser refused to save the update (storage full or blocked).");
      setSaving(false);
      return;
    }
    router.push(`/projects/${encodeURIComponent(bundle.project.id)}`);
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Weekly update</h2>
          <p className="text-sm text-ink-2">About two minutes. Only change what moved this week.</p>
        </div>
        <Field label="Data date" htmlFor="data-date" className="w-44">
          <input id="data-date" type="date" className="control" value={dataDate} onChange={(e) => setDataDate(e.target.value)} />
        </Field>
      </div>

      <h3 className="mt-8 text-base font-semibold">Progress</h3>
      <p className="mt-1 text-sm text-ink-2">
        Activities in progress or due to start by {fmtDay(addCalendarDays(dataDate, 21))}.{" "}
        <button type="button" className="text-ink underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : "Show all"}
        </button>
      </p>
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {candidates.map((a) => {
          const row = rows[a.id];
          const pct = row?.pct ?? a.percentComplete;
          const plan = plannedPct(a.baselineStart, a.baselineFinish);
          const behind = pct < plan - 5;
          return (
            <li key={a.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium leading-6">{a.name}</p>
                  <p className="text-xs text-ink-2">
                    <span className="font-mono">{a.code}</span> · was {a.percentComplete.toFixed(0)}% · plan says {plan}% by now
                    {a.critical ? " · critical" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    aria-label={`${a.name} percent complete`}
                    className="control w-20 text-right"
                    inputMode="numeric"
                    value={pct}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) setRow(a.id, { pct: Math.min(100, Math.max(0, Math.round(n))) });
                    }}
                  />
                  <span className="text-sm text-ink-2">%</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button className="h-8" onClick={() => setRow(a.id, { pct: Math.min(100, pct + 10) })}>
                  +10%
                </Button>
                <Button className="h-8" onClick={() => setRow(a.id, { pct: 100 })}>
                  Done
                </Button>
                {behind ? (
                  <>
                    <Badge tone="warn">behind plan</Badge>
                    <select
                      aria-label={`Why is ${a.name} behind?`}
                      className="control h-8 min-h-0 w-auto py-0 text-sm"
                      value={row?.why ?? ""}
                      onChange={(e) => setRow(a.id, { why: (e.target.value || undefined) as DelayCategory | undefined, party: undefined })}
                    >
                      <option value="">Why?</option>
                      {DELAY_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                    {row?.why ? <OwnerTag owner={row.party ?? DEFAULT_PARTY[row.why]} /> : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
        {candidates.length === 0 ? <li className="py-3 text-sm text-ink-2">Nothing in progress or due. Use “Show all” to report early starts.</li> : null}
      </ul>

      <h3 className="mt-10 text-base font-semibold">Payments</h3>
      <p className="mt-1 text-sm text-ink-2">IPC dates prove payment delays. Fill in what happened this week.</p>
      <ul className="mt-3 divide-y divide-rule border-y border-rule">
        {unpaid.map((p) => {
          const edit = paymentEdits[p.id] ?? {};
          return (
            <li key={p.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_9.5rem_9.5rem] sm:items-end">
              <div>
                <p className="font-medium">IPC {p.ipcNumber}</p>
                <p className="text-xs text-ink-2">
                  submitted {fmtDate(p.submittedOn)} · {pkr(p.amountCertifiedPkr ?? p.amountClaimedPkr)}
                </p>
              </div>
              <Field label="Certified on" htmlFor={`cert-${p.id}`}>
                <input
                  id={`cert-${p.id}`}
                  type="date"
                  className="control"
                  value={edit.certifiedOn ?? p.certifiedOn ?? ""}
                  onChange={(e) => setPaymentEdits((m) => ({ ...m, [p.id]: { ...m[p.id], certifiedOn: e.target.value || undefined, amountCertifiedPkr: p.amountCertifiedPkr ?? p.amountClaimedPkr } }))}
                />
              </Field>
              <Field label="Paid on" htmlFor={`paid-${p.id}`}>
                <input
                  id={`paid-${p.id}`}
                  type="date"
                  className="control"
                  value={edit.paidOn ?? ""}
                  onChange={(e) => setPaymentEdits((m) => ({ ...m, [p.id]: { ...m[p.id], paidOn: e.target.value || undefined, amountPaidPkr: p.amountCertifiedPkr ?? p.amountClaimedPkr } }))}
                />
              </Field>
            </li>
          );
        })}
        <li className="py-3">
          {newIpc ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="New IPC submitted on" htmlFor="ipc-date">
                <input id="ipc-date" type="date" className="control" value={newIpc.submittedOn} onChange={(e) => setNewIpc({ ...newIpc, submittedOn: e.target.value })} />
              </Field>
              <Field label="Amount claimed (PKR)" htmlFor="ipc-amount">
                <input id="ipc-amount" inputMode="decimal" className="control" value={newIpc.amount} onChange={(e) => setNewIpc({ ...newIpc, amount: e.target.value })} />
              </Field>
            </div>
          ) : (
            <Button onClick={() => setNewIpc({ submittedOn: addCalendarDays(dataDate, -1), amount: "" })}>Add an IPC</Button>
          )}
        </li>
      </ul>

      <h3 className="mt-10 text-base font-semibold">Events and causes</h3>
      <p className="mt-1 text-sm text-ink-2">
        Anything that cost time: an RFI, a site instruction, rain, a shortage. Dated and attributed, it becomes evidence.
      </p>
      {openIssues.length ? (
        <ul className="mt-3 divide-y divide-rule border-y border-rule">
          {openIssues.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 text-sm">
                <p className="leading-6">
                  {e.reference ? <span className="mr-1.5 font-mono text-[0.8125rem]">{e.reference}</span> : null}
                  {e.description}
                </p>
                <p className="text-xs text-ink-2">
                  open since {fmtDate(e.eventDate)} · {OWNER_LABEL[e.responsibleParty]}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={resolved.has(e.id)}
                  onChange={(ev) =>
                    setResolved((s) => {
                      const n = new Set(s);
                      if (ev.target.checked) n.add(e.id);
                      else n.delete(e.id);
                      return n;
                    })
                  }
                />
                Resolved
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 space-y-4">
        {events.map((e, i) => (
          <fieldset key={e.key} className="grid gap-3 rounded-[6px] border border-rule bg-sheet p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">New event</legend>
            <Field label="What happened" htmlFor={`ev-d-${e.key}`} className="sm:col-span-2">
              <input
                id={`ev-d-${e.key}`}
                className="control"
                value={e.description}
                placeholder="e.g. Revised column schedule awaited"
                onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, description: ev.target.value } : x)))}
              />
            </Field>
            <Field label="Cause" htmlFor={`ev-c-${e.key}`}>
              <select
                id={`ev-c-${e.key}`}
                className="control"
                value={e.category}
                onChange={(ev) => {
                  const category = ev.target.value as DelayCategory;
                  setEvents((list) => list.map((x, k) => (k === i ? { ...x, category, responsibleParty: DEFAULT_PARTY[category] } : x)));
                }}
              >
                {DELAY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Who caused it" htmlFor={`ev-p-${e.key}`}>
              <select
                id={`ev-p-${e.key}`}
                className="control"
                value={e.responsibleParty}
                onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, responsibleParty: ev.target.value as ResponsibleParty } : x)))}
              >
                {RESPONSIBLE_PARTIES.map((p) => (
                  <option key={p} value={p}>
                    {OWNER_LABEL[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date" htmlFor={`ev-t-${e.key}`}>
              <input id={`ev-t-${e.key}`} type="date" className="control" value={e.eventDate} onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, eventDate: ev.target.value } : x)))} />
            </Field>
            <Field label="Letter or RFI number" htmlFor={`ev-r-${e.key}`}>
              <input id={`ev-r-${e.key}`} className="control font-mono" value={e.reference} onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, reference: ev.target.value } : x)))} />
            </Field>
            <Field label="Activity affected" htmlFor={`ev-a-${e.key}`}>
              <select id={`ev-a-${e.key}`} className="control" value={e.activityId} onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, activityId: ev.target.value } : x)))}>
                <option value="">None in particular</option>
                {bundle.activities.filter((a) => !a.isMilestone).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Days lost" htmlFor={`ev-l-${e.key}`}>
              <input id={`ev-l-${e.key}`} inputMode="decimal" className="control" value={e.daysLost} onChange={(ev) => setEvents((list) => list.map((x, k) => (k === i ? { ...x, daysLost: ev.target.value } : x)))} />
            </Field>
            <div className="sm:col-span-2">
              <Button variant="ghost" onClick={() => setEvents((list) => list.filter((_, k) => k !== i))}>
                Remove
              </Button>
            </div>
          </fieldset>
        ))}
        <Button
          onClick={() =>
            setEvents((list) => [
              ...list,
              { key: newId(), eventDate: addCalendarDays(dataDate, -1), category: "design_query", responsibleParty: "consultant", description: "", reference: "", daysLost: "", activityId: "" },
            ])
          }
        >
          Add an event
        </Button>
      </div>

      <Field label="Notes" htmlFor="notes" className="mt-10" hint="Optional. Goes into the site record.">
        <textarea id="notes" rows={3} className="control" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-panel/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <p className={`text-sm ${error ? "text-risk" : "text-ink-2"}`}>{error ?? `Saving runs this week's forecast for ${fmtDate(dataDate)}.`}</p>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save update"}
          </Button>
        </div>
      </div>
    </main>
  );
}
