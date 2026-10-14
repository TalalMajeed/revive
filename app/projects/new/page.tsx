"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Field, LearningNote } from "@/components/ui";
import { createProjectBundle } from "@/lib/data/create";
import { newId, saveProject } from "@/lib/data/store";
import { EMPTY_SETUP, type SetupAnswers } from "@/lib/data/types";
import {
  CLIENT_TYPE_LABELS,
  DESIGN_STATUS_LABELS,
  FUNDING_SOURCE_LABELS,
  PEC_CATEGORY_LABELS,
  PROJECT_TYPE_LABELS,
  PROVINCE_LABELS,
  predictAwardRisk,
} from "@/lib/forecast/award";
import { fmtDate, pct, pkr } from "@/lib/format";
import { importSchedule, type ImportedSchedule } from "@/lib/schedule";

const STEPS = ["Project", "Contract and award", "Schedule", "Review"] as const;

interface Basics {
  name: string;
  code: string;
  location: string;
}

export default function NewProject() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [basics, setBasics] = useState<Basics>({ name: "", code: "", location: "" });
  const [setup, setSetup] = useState<SetupAnswers>(EMPTY_SETUP);
  const [schedule, setSchedule] = useState<ImportedSchedule | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof SetupAnswers>(key: K, value: SetupAnswers[K]) =>
    setSetup((s) => ({ ...s, [key]: value }));

  const validate = (s: number): boolean => {
    const e: Record<string, string> = {};
    if (s === 0 && !basics.name.trim()) e.name = "Give the project a name.";
    if (s === 1) {
      if (setup.contract_start_date && setup.original_completion_date && setup.original_completion_date < setup.contract_start_date) {
        e.original_completion_date = "Completion must be after the start date.";
      }
      if (setup.funding_secured_pct !== null && (setup.funding_secured_pct < 0 || setup.funding_secured_pct > 100)) {
        e.funding_secured_pct = "Enter a percentage from 0 to 100.";
      }
    }
    if (s === 2 && !schedule) e.schedule = "Upload a schedule file or use the sample to continue.";
    if (s === 3 && !(setup.original_completion_date ?? schedule?.plannedFinish)) {
      e.review = "Add the original completion date (question 12): it is what late is measured against.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => validate(step) && setStep((s) => Math.min(s + 1, STEPS.length - 1));

  const readFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const imported = importSchedule(text);
      if (imported.activities.length === 0) throw new Error("The file has no activities.");
      setSchedule(imported);
      setFileName(file.name);
      setErrors({});
    } catch (err) {
      setSchedule(null);
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const useSample = async () => {
    const res = await fetch("/samples/revive-sample.xer");
    await readFile(new File([await res.text()], "revive-sample.xer"));
  };

  const award = useMemo(() => predictAwardRisk(setup), [setup]);

  const create = () => {
    if (!validate(3) || !schedule) return;
    setSaving(true);
    const id = newId();
    const bundle = createProjectBundle({ id, ...basics, setup, schedule });
    if (!saveProject(bundle)) {
      setErrors({ review: "This browser refused to save the project (storage full or blocked)." });
      setSaving(false);
      return;
    }
    router.push(`/projects/${encodeURIComponent(id)}`);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Set up a project</h1>
      <p className="mt-1 text-sm text-ink-2">Once per project, about five minutes. You can leave any answer you don&apos;t know blank.</p>

      <ol className="mt-6 grid grid-cols-4 gap-2 text-xs" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={`w-full border-t-2 pt-2 text-left transition-colors ${
                i === step ? "border-ink font-medium text-ink" : i < step ? "border-ink-3 text-ink-2 hover:text-ink" : "border-rule text-ink-3"
              }`}
              aria-current={i === step ? "step" : undefined}
            >
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-[6px] border border-rule bg-sheet p-5 sm:p-6">
        {step === 0 ? (
          <div className="grid gap-5">
            <Field label="Project name" htmlFor="name" error={errors.name}>
              <input
                id="name"
                className="control"
                value={basics.name}
                aria-invalid={!!errors.name}
                placeholder="e.g. Tehsil hospital, Kabirwala: OPD block"
                onChange={(e) => setBasics({ ...basics, name: e.target.value })}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Contract number" htmlFor="code" hint="Optional">
                <input id="code" className="control font-mono" value={basics.code} onChange={(e) => setBasics({ ...basics, code: e.target.value })} />
              </Field>
              <Field label="Location" htmlFor="location" hint="Optional">
                <input id="location" className="control" value={basics.location} placeholder="e.g. Kabirwala, Khanewal" onChange={(e) => setBasics({ ...basics, location: e.target.value })} />
              </Field>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-6">
            <Group title="The work">
              <Select label="1. What is being built?" value={setup.project_type} options={PROJECT_TYPE_LABELS} onChange={(v) => set("project_type", v)} />
              <Select label="2. Province or territory" value={setup.province} options={PROVINCE_LABELS} onChange={(v) => set("province", v)} />
              <Select
                label="3. How complete was the design at award?"
                value={setup.design_status_at_award}
                options={{ complete: "Complete", partial: "Partial", concept: "Concept only" } satisfies Record<keyof typeof DESIGN_STATUS_LABELS, string>}
                onChange={(v) => set("design_status_at_award", v)}
              />
              <Select label="4. Contractor's PEC category" value={setup.pec_category} options={PEC_CATEGORY_LABELS} onChange={(v) => set("pec_category", v)} />
            </Group>
            <Group title="Client and money">
              <Select label="5. Who is the client?" value={setup.client_type} options={CLIENT_TYPE_LABELS} onChange={(v) => set("client_type", v)} />
              <Select label="6. Where does the money come from?" value={setup.funding_source} options={FUNDING_SOURCE_LABELS} onChange={(v) => set("funding_source", v)} />
              <NumberField
                label="7. Funding secured (%)"
                hint="Share of the contract value allocated or released so far"
                value={setup.funding_secured_pct}
                error={errors.funding_secured_pct}
                onChange={(v) => set("funding_secured_pct", v)}
              />
            </Group>
            <Group title="Tender">
              <NumberField label="8. Contract value (PKR)" value={setup.contract_value_pkr} onChange={(v) => set("contract_value_pkr", v)} hint={setup.contract_value_pkr ? pkr(setup.contract_value_pkr) : undefined} />
              <NumberField label="9. Engineer's estimate (PKR)" value={setup.engineers_estimate_pkr} onChange={(v) => set("engineers_estimate_pkr", v)} hint={setup.engineers_estimate_pkr ? pkr(setup.engineers_estimate_pkr) : undefined} />
              <NumberField label="10. Number of bids received" value={setup.bidders_count} onChange={(v) => set("bidders_count", v)} />
            </Group>
            <Group title="Contract dates">
              <DateField label="11. Contract start (commencement) date" value={setup.contract_start_date} onChange={(v) => set("contract_start_date", v)} hint="Defaults to the schedule's start" />
              <DateField
                label="12. Original completion date"
                value={setup.original_completion_date}
                onChange={(v) => set("original_completion_date", v)}
                error={errors.original_completion_date}
                hint="As signed, before any extension. Late is measured against this."
              />
            </Group>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <p className="max-w-prose text-sm leading-6 text-ink-2">
              Upload the programme as a Primavera P6 export (<span className="font-mono">.xer</span>) or, from MS
              Project, File › Save As › XML (<span className="font-mono">.xml</span>). The file stays in this browser.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex h-9 cursor-pointer items-center rounded-[4px] border border-ink bg-ink px-3 text-sm font-medium text-sheet transition-colors hover:bg-[#33312c] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
                Choose schedule file
                <input
                  type="file"
                  accept=".xer,.xml,text/xml"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
                />
              </label>
              <Button onClick={useSample}>Use the sample schedule</Button>
              {fileName ? <span className="text-sm text-ink-2">{fileName}</span> : null}
            </div>
            {importError ? <p className="mt-3 text-sm text-risk">Couldn&apos;t read that file: {importError}</p> : null}
            {errors.schedule && !schedule ? <p className="mt-3 text-sm text-risk">{errors.schedule}</p> : null}
            {schedule ? <ScheduleSummary schedule={schedule} /> : null}
          </div>
        ) : null}

        {step === 3 && schedule ? (
          <div className="grid gap-6">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item term="Project">{basics.name}</Item>
              <Item term="Schedule">
                {schedule.activities.length} activities from {fileName}
              </Item>
              <Item term="Contract start">{fmtDate(setup.contract_start_date ?? schedule.plannedStart)}</Item>
              <Item term="Original completion">{fmtDate(setup.original_completion_date ?? schedule.plannedFinish)}</Item>
              <Item term="Contract value">{pkr(setup.contract_value_pkr)}</Item>
              <Item term="Bids received">{setup.bidders_count ?? "—"}</Item>
            </dl>
            <div className="border-t border-rule pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">Risk at award</h2>
                <span className="text-2xl font-semibold">{pct(award.probabilityLate)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-2">Chance of finishing more than a month late, from the twelve answers alone.</p>
              <ul className="mt-3 divide-y divide-rule text-sm">
                {award.reasons.map((r) => (
                  <li key={r.feature} className="flex items-center justify-between gap-3 py-2">
                    <span>{r.label}</span>
                    <Badge tone={r.direction === "raises" ? "risk" : "ok"}>{r.direction === "raises" ? "raises risk" : "lowers risk"}</Badge>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <LearningNote>
                  Demo model trained on synthetic data to show how the explainable model works. It is not a real
                  prediction and gets no weight in the forecast until it is trained on finished projects.
                </LearningNote>
              </div>
            </div>
            {errors.review ? <p className="text-sm text-risk">{errors.review}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button variant="primary" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button variant="primary" onClick={create} disabled={saving}>
            {saving ? "Creating…" : "Create project"}
          </Button>
        )}
      </div>
    </main>
  );
}

function ScheduleSummary({ schedule }: { schedule: ImportedSchedule }) {
  const done = schedule.activities.filter((a) => a.status === "complete").length;
  const going = schedule.activities.filter((a) => a.status === "in_progress").length;
  return (
    <div className="mt-6 border-t border-rule pt-5">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Item term="Project in file">{schedule.projectName}</Item>
        <Item term="Activities">
          {schedule.activities.length} ({done} done, {going} in progress)
        </Item>
        <Item term="Links">{schedule.dependencies.length}</Item>
        <Item term="Planned start">{fmtDate(schedule.plannedStart)}</Item>
        <Item term="Planned finish">{fmtDate(schedule.plannedFinish)}</Item>
        <Item term="Status date">{fmtDate(schedule.dataDate)}</Item>
      </dl>
      {schedule.warnings.length ? (
        <ul className="mt-4 space-y-1 text-sm text-warn">
          {schedule.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 max-h-64 overflow-auto border-y border-rule">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-rule">
            {schedule.activities.map((a) => (
              <tr key={a.id}>
                <td className="w-24 py-1.5 pr-3 font-mono text-[0.8125rem] text-ink-2">{a.code}</td>
                <td className="py-1.5 pr-3">{a.name}</td>
                <td className="w-24 py-1.5 text-right text-ink-2">{a.isMilestone ? "milestone" : `${a.originalDuration} d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-2">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: Record<T, string>;
  onChange: (v: T | null) => void;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="control" value={value ?? ""} onChange={(e) => onChange((e.target.value || null) as T | null)}>
        <option value="">Not known</option>
        {(Object.entries(options) as Array<[T, string]>).map(([k, v]) => (
          <option key={k} value={k}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </option>
        ))}
      </select>
    </Field>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
  error?: string;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <input
        id={id}
        className="control"
        inputMode="decimal"
        value={value ?? ""}
        aria-invalid={!!error}
        onChange={(e) => {
          const raw = e.target.value.replace(/[,\s]/g, "");
          const n = Number(raw);
          onChange(raw === "" || !Number.isFinite(n) ? null : n);
        }}
      />
    </Field>
  );
}

function DateField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
  error?: string;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  return (
    <Field label={label} htmlFor={id} hint={hint} error={error}>
      <input id={id} type="date" className="control" value={value ?? ""} aria-invalid={!!error} onChange={(e) => onChange(e.target.value || null)} />
    </Field>
  );
}
