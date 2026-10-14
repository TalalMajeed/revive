import type { DelayCategory, ProjectBundle, Reason, ResponsibleParty } from "@/lib/data/types";
import { fmtDate as fmt, pkr } from "@/lib/format";
import { daysBetween, type Signals } from "./signals";
import type { WeeklyStatus } from "./status";

/**
 * "Why is it slipping?" before the model is trained: rules over the weekly
 * records, each reason with an owner and an action. Written from templates,
 * no LLM. Ranked by a rough estimate of the working days each accounts for.
 */

export const OWNER_LABEL: Record<ResponsibleParty, string> = {
  client: "Client",
  consultant: "Consultant",
  contractor: "Contractor",
  subcontractor: "Subcontractor",
  supplier: "Supplier",
  authority: "Authority",
  none: "No one (neutral event)",
};

export const CATEGORY_LABEL: Record<DelayCategory, string> = {
  design_query: "Design query",
  drawing_delay: "Drawings late",
  variation_order: "Variation order",
  payment_delay: "Payment delay",
  site_access: "Site access",
  material_shortage: "Material shortage",
  crew_shortage: "Crew shortage",
  equipment_breakdown: "Equipment breakdown",
  weather: "Weather",
  utility_shifting: "Utility shifting",
  law_and_order: "Law and order",
  other: "Other",
};

const ACTIVITY_ACTION: Partial<Record<DelayCategory, string>> = {
  crew_shortage: "Bring in a second gang or a labour subcontractor for the next two weeks.",
  material_shortage: "Expedite the supplier and line up an alternate source this week.",
  equipment_breakdown: "Hire a standby machine until the repair is done.",
  site_access: "Write to the Engineer to record the access restriction and ask for a date.",
  design_query: "Chase the RFI with the Engineer's representative and record the date.",
  drawing_delay: "Chase the drawings with the Engineer's representative and record the date.",
};

export function buildReasons(bundle: ProjectBundle, status: WeeklyStatus, signals: Signals): Reason[] {
  const reasons: Reason[] = [];
  const dataDate = status.dataDate;
  const byId = new Map(status.activities.map((a) => [a.id, a]));

  for (const p of signals.overduePayments.slice(0, 2)) {
    reasons.push({
      key: `ipc-${p.ipcNumber}`,
      title: `IPC ${p.ipcNumber} is ${p.daysOverdue} days overdue`,
      detail: `Certified on ${fmt(p.certifiedOn)} and due on ${fmt(p.dueOn)}${p.amountPkr ? `, ${pkr(p.amountPkr)} outstanding` : ""}. Cash shortfalls slow every trade on site.`,
      owner: "client",
      action: "Send a notice of late payment under the contract's payment clause and log it for the EOT claim.",
      impactDays: Math.round(p.daysOverdue / 6),
    });
  }

  // One reason per open issue: reminders about the same RFI on the same
  // activity are folded into the first record.
  const seen = new Set<string>();
  const designIssues = signals.openDesignIssues.filter((e) => {
    const k = `${e.activityId ?? e.id}:${e.category}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const e of designIssues.slice(0, 3)) {
    const act = e.activityId ? byId.get(e.activityId) : undefined;
    const open = daysBetween(e.eventDate, dataDate);
    reasons.push({
      key: `event-${e.id}`,
      title: `${e.reference ? `${e.reference}: ` : ""}${e.description}`,
      detail: `Open for ${open} days${act ? `, holding ${act.name}${act.critical ? " on the critical path" : ""}` : ""}.`,
      owner: e.responsibleParty,
      action: ACTIVITY_ACTION[e.category] ?? "Escalate with the Engineer's representative.",
      impactDays: Math.round((act?.critical ? 1 : 0.3) * open * (6 / 7)),
    });
  }

  for (const e of signals.openVariationOrders.slice(0, 1)) {
    reasons.push({
      key: `event-${e.id}`,
      title: `Variation order pending: ${e.description}`,
      detail: `Raised on ${fmt(e.eventDate)} and not yet approved.`,
      owner: "client",
      action: "Ask for the VO to be approved with a time extension, not just a cost adjustment.",
      impactDays: Math.round(daysBetween(e.eventDate, dataDate) * 0.3),
    });
  }

  // The critical activity driving the slip: the first unfinished one on the
  // critical path that is behind plan (its successors inherit the same
  // slip, so listing them would repeat it).
  const driver = status.activities
    .filter((a) => a.critical && a.status !== "complete" && a.slipDays > 0 && !a.isMilestone)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  for (const a of driver ? [driver] : []) {
    const cause = mainCause(bundle, a.id, dataDate);
    const names = new Map(bundle.activities.map((x) => [x.id, x.name]));
    const where = cause && cause.activityIds.length && !cause.activityIds.includes(a.id)
      ? ` on ${cause.activityIds.slice(0, 2).map((id) => names.get(id)).join(" and ")}`
      : "";
    reasons.push({
      key: `slip-${a.id}`,
      title: `${a.name} is ${a.slipDays} days behind plan and on the critical path`,
      detail: cause
        ? `Mostly from ${CATEGORY_LABEL[cause.category].toLowerCase()}${where}: ${cause.days} days lost in the weekly updates so far.`
        : "No cause reported yet. Add one in the weekly update so it counts as evidence.",
      owner: cause?.party ?? "contractor",
      action: (cause && ACTIVITY_ACTION[cause.category]) ?? "Review this week's look-ahead; see the recovery plan for the cheapest speed-up.",
      impactDays: a.slipDays,
    });
  }

  if (signals.weatherDaysLost >= 2) {
    reasons.push({
      key: "weather",
      title: `${signals.weatherDaysLost} days lost to weather in the last four weeks`,
      detail: "Neutral event under most contracts: time, but no money.",
      owner: "none",
      action: "Keep the site diary entries; check the adverse-weather clause before claiming.",
      impactDays: signals.weatherDaysLost,
    });
  }

  if (status.actualTimeDays > 24 && status.spiT < 0.9 && status.actualPercent < 100) {
    reasons.push({
      key: "pace",
      title: `Work is moving at ${Math.round(status.spiT * 100)}% of the planned pace`,
      detail: `${status.actualPercent.toFixed(0)}% done against ${status.plannedPercent.toFixed(0)}% planned by now.`,
      owner: "contractor",
      action: "Compare this week's manpower and machines with the resource plan.",
      impactDays: Math.round(status.actualTimeDays - status.earnedScheduleDays),
    });
  }

  return reasons.sort((a, b) => b.impactDays - a.impactDays).slice(0, 5);
}

/**
 * The biggest reported cause of lost days on an activity and everything
 * upstream of it: slip reasons summed by category and owner.
 */
export function mainCause(bundle: ProjectBundle, activityId: string, dataDate: string) {
  const preds = new Map<string, string[]>();
  for (const d of bundle.dependencies) preds.set(d.successorId, [...(preds.get(d.successorId) ?? []), d.predecessorId]);
  const upstream = new Set<string>();
  const stack = [activityId];
  while (stack.length) {
    const id = stack.pop()!;
    if (upstream.has(id)) continue;
    upstream.add(id);
    stack.push(...(preds.get(id) ?? []));
  }
  const updateDates = new Map(bundle.updates.map((u) => [u.id, u.dataDate]));
  const totals = new Map<string, { category: DelayCategory; party: ResponsibleParty; days: number; activityIds: string[] }>();
  for (const r of bundle.slipReasons) {
    if (!r.activityId || !upstream.has(r.activityId)) continue;
    if ((updateDates.get(r.updateId) ?? "9999") > dataDate) continue;
    const k = `${r.category}:${r.responsibleParty}`;
    const t = totals.get(k) ?? { category: r.category, party: r.responsibleParty, days: 0, activityIds: [] };
    t.days += r.daysSlipped ?? 0;
    if (!t.activityIds.includes(r.activityId)) t.activityIds.push(r.activityId);
    totals.set(k, t);
  }
  const best = [...totals.values()].sort((a, b) => b.days - a.days)[0];
  return best && best.days >= 1 ? { ...best, days: Math.round(best.days) } : undefined;
}
