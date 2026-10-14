import type { ProjectBundle, ResponsibleParty, WeeklyEvent } from "@/lib/data/types";
import { addCalendarDays } from "@/lib/schedule";
import { DEFAULT_PAYMENT_DAYS, daysBetween } from "./signals";
import { sortedUpdates } from "./state";
import { weeklyStatus } from "./status";

/**
 * The records behind an extension-of-time claim: who carries the risk for
 * each lost day, whether the affected work was critical when it happened,
 * and how late each IPC was paid. Indicative only; the contract and the
 * Engineer's assessment decide entitlement.
 */

export type RiskGroup = "employer" | "neutral" | "contractor";

export const RISK_GROUP: Record<ResponsibleParty, RiskGroup> = {
  client: "employer",
  consultant: "employer",
  authority: "employer",
  none: "neutral",
  contractor: "contractor",
  subcontractor: "contractor",
  supplier: "contractor",
};

export const RISK_GROUP_LABEL: Record<RiskGroup, { title: string; note: string }> = {
  employer: { title: "Employer's risk", note: "Client, consultant or authority: time, and often cost" },
  neutral: { title: "Neutral events", note: "Weather and similar: usually time only" },
  contractor: { title: "Contractor's risk", note: "Own crews, subcontractors, suppliers: no extension" },
};

export interface EventEvidence {
  event: WeeklyEvent;
  group: RiskGroup;
  activityName?: string;
  /** Whether the affected activity was on the critical path in the week it happened. */
  criticalAtTheTime?: boolean;
  daysOpen?: number;
}

export function lostDaysByGroup(bundle: ProjectBundle, upTo?: string): Record<RiskGroup, number> {
  const dates = new Map(bundle.updates.map((u) => [u.id, u.dataDate]));
  const out: Record<RiskGroup, number> = { employer: 0, neutral: 0, contractor: 0 };
  for (const r of bundle.slipReasons) {
    if (upTo && (dates.get(r.updateId) ?? "") > upTo) continue;
    out[RISK_GROUP[r.responsibleParty]] += r.daysSlipped ?? 0;
  }
  return out;
}

export function eventEvidence(bundle: ProjectBundle, asOf: string): EventEvidence[] {
  const updates = sortedUpdates(bundle);
  const names = new Map(bundle.activities.map((a) => [a.id, a.name]));
  const statusCache = new Map<number, ReturnType<typeof weeklyStatus>>();
  const statusFor = (i: number) => {
    let s = statusCache.get(i);
    if (!s) statusCache.set(i, (s = weeklyStatus(bundle, i)));
    return s;
  };
  return bundle.events
    .filter((e) => e.eventDate <= asOf)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((event) => {
      let critical: boolean | undefined;
      if (event.activityId) {
        // The last update before the event shows the critical path it hit.
        let idx = -1;
        updates.forEach((u, i) => {
          if (u.dataDate <= event.eventDate) idx = i;
        });
        const a = statusFor(idx).activities.find((x) => x.id === event.activityId);
        critical = a ? a.critical || a.totalFloat <= 0 : undefined;
      }
      const end = event.resolvedOn && event.resolvedOn <= asOf ? event.resolvedOn : asOf;
      return {
        event,
        group: RISK_GROUP[event.responsibleParty],
        activityName: event.activityId ? names.get(event.activityId) : undefined,
        criticalAtTheTime: critical,
        daysOpen: event.category === "weather" ? undefined : daysBetween(event.eventDate, end),
      };
    });
}

export interface PaymentEvidence {
  ipcNumber: number;
  submittedOn?: string;
  certifiedOn?: string;
  dueOn?: string;
  paidOn?: string;
  amountPkr?: number;
  /** Calendar days paid after the due date (or overdue as of the date given). */
  daysLate: number;
  open: boolean;
}

export function paymentEvidence(bundle: ProjectBundle, asOf: string): PaymentEvidence[] {
  return [...bundle.payments]
    .filter((p) => !p.submittedOn || p.submittedOn <= asOf)
    .sort((a, b) => a.ipcNumber - b.ipcNumber)
    .map((p) => {
      const dueOn = p.dueOn ?? (p.certifiedOn ? addCalendarDays(p.certifiedOn, DEFAULT_PAYMENT_DAYS) : undefined);
      const paid = p.paidOn && p.paidOn <= asOf ? p.paidOn : undefined;
      const daysLate = dueOn ? Math.max(0, daysBetween(dueOn, paid ?? asOf)) : 0;
      return {
        ipcNumber: p.ipcNumber,
        submittedOn: p.submittedOn,
        certifiedOn: p.certifiedOn && p.certifiedOn <= asOf ? p.certifiedOn : undefined,
        dueOn,
        paidOn: paid,
        amountPkr: p.amountCertifiedPkr ?? p.amountClaimedPkr,
        daysLate: p.certifiedOn && p.certifiedOn <= asOf ? daysLate : 0,
        open: !paid,
      };
    });
}
