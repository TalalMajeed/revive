import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { ResponsibleParty } from "@/lib/data/types";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON: Record<Variant, string> = {
  primary: "bg-ink text-sheet border-ink hover:bg-[#33312c]",
  secondary: "bg-sheet text-ink border-rule-strong hover:border-ink",
  ghost: "bg-transparent text-ink-2 border-transparent hover:text-ink hover:bg-panel",
  danger: "bg-sheet text-risk border-rule-strong hover:border-risk",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[4px] border px-3 h-9 text-sm font-medium no-underline transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={`${BASE} ${BUTTON[variant]} ${className}`} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${BASE} ${BUTTON[variant]} ${className}`} {...props} />;
}

export type Tone = "ok" | "warn" | "risk" | "neutral" | "ink";

const TONE: Record<Tone, string> = {
  ok: "bg-ok-wash text-ok",
  warn: "bg-warn-wash text-warn",
  risk: "bg-risk-wash text-risk",
  neutral: "bg-panel text-ink-2",
  ink: "bg-ink text-sheet",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-xs font-medium leading-4 ${TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function healthTone(score: number): Tone {
  return score >= 70 ? "ok" : score >= 40 ? "warn" : "risk";
}

export function healthLabel(score: number): string {
  return score >= 70 ? "On track" : score >= 40 ? "At risk" : "Critical";
}

const OWNER: Record<ResponsibleParty, string> = {
  client: "Client",
  consultant: "Consultant",
  contractor: "Contractor",
  subcontractor: "Subcontractor",
  supplier: "Supplier",
  authority: "Authority",
  none: "Neutral",
};

export function OwnerTag({ owner }: { owner: ResponsibleParty }) {
  const employer = owner === "client" || owner === "consultant" || owner === "authority";
  return <Badge tone={employer ? "ink" : "neutral"}>{OWNER[owner]}</Badge>;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-risk">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

/** A titled block separated by a hairline, the page's main rhythm. */
export function Section({
  title,
  aside,
  children,
  className = "",
  id,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 border-t border-rule pt-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {aside ? <div className="text-sm text-ink-2">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[4px] bg-panel ${className}`} />;
}

export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-80 max-w-full" />
      <Skeleton className="mt-3 h-4 w-56" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-8 h-64" />
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.8125rem] ${className}`}>{children}</span>;
}

/** Learning / demo labels: honest about what is not validated. */
export function LearningNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs leading-5 text-ink-2">
      <svg width="14" height="14" viewBox="0 0 16 16" className="mt-0.5 shrink-0" aria-hidden="true">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 7v4M8 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
