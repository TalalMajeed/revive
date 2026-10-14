import type { ProjectBundle, WeeklyEvent } from "@/lib/data/types";
import { addCalendarDays, parseIsoDate } from "@/lib/schedule";

/**
 * Warning signs read from the weekly records as of a data date. They widen
 * the simulation's ranges and feed the reasons and the health score.
 */

export interface OverduePayment {
  ipcNumber: number;
  certifiedOn: string;
  dueOn: string;
  daysOverdue: number;
  amountPkr?: number;
}

export interface Signals {
  overduePayments: OverduePayment[];
  /** Longest overdue certified IPC, in calendar days. */
  paymentDelayDays: number;
  /** Design queries and drawing delays raised and not resolved by the data date. */
  openDesignIssues: WeeklyEvent[];
  openVariationOrders: WeeklyEvent[];
  /** Events in the four weeks to the data date. */
  recentEvents: WeeklyEvent[];
  weatherDaysLost: number;
}

/** Days after certification an IPC falls due when the contract date isn't recorded. */
export const DEFAULT_PAYMENT_DAYS = 30;

export function readSignals(bundle: ProjectBundle, dataDate: string): Signals {
  const overduePayments: OverduePayment[] = [];
  for (const p of bundle.payments) {
    if (!p.certifiedOn || p.certifiedOn > dataDate) continue;
    const dueOn = p.dueOn ?? addCalendarDays(p.certifiedOn, DEFAULT_PAYMENT_DAYS);
    const paidBy = p.paidOn && p.paidOn <= dataDate ? p.paidOn : undefined;
    if (paidBy) continue;
    const daysOverdue = daysBetween(dueOn, dataDate);
    if (daysOverdue > 0) {
      overduePayments.push({
        ipcNumber: p.ipcNumber,
        certifiedOn: p.certifiedOn,
        dueOn,
        daysOverdue,
        amountPkr: p.amountCertifiedPkr,
      });
    }
  }
  overduePayments.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const raised = bundle.events.filter((e) => e.eventDate <= dataDate);
  const open = (e: WeeklyEvent) => !e.resolvedOn || e.resolvedOn > dataDate;
  const fourWeeksAgo = addCalendarDays(dataDate, -28);
  const recentEvents = raised.filter((e) => e.eventDate > fourWeeksAgo);

  return {
    overduePayments,
    paymentDelayDays: overduePayments[0]?.daysOverdue ?? 0,
    openDesignIssues: raised.filter(
      (e) => (e.category === "design_query" || e.category === "drawing_delay") && open(e),
    ),
    openVariationOrders: raised.filter((e) => e.category === "variation_order" && open(e)),
    recentEvents,
    weatherDaysLost: recentEvents
      .filter((e) => e.category === "weather")
      .reduce((sum, e) => sum + (e.daysLost ?? 0), 0),
  };
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseIsoDate(b) - parseIsoDate(a)) / 86_400_000);
}
