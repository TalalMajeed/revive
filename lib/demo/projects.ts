import type { Payment } from "@/lib/data/types";
import type { DemoActivity, DemoSpec, Disruption } from "./site";

/**
 * Three illustrative projects. Names, codes, amounts and events are made up
 * for the demo; the patterns (late IPCs on ADP-funded work, RFIs holding
 * slabs, utility shifting at culverts, monsoon) are the common ones in
 * Pakistani delay studies.
 */

function building(): DemoActivity[] {
  return [
    { code: "A1000", name: "Mobilisation and site office", duration: 8, trade: "prelims" },
    { code: "A1010", name: "Setting out and excavation", duration: 12, trade: "earthworks", preds: [["A1000"]] },
    { code: "A1020", name: "Foundations: PCC and footings", duration: 18, trade: "concrete", preds: [["A1010", "SS", 6]] },
    { code: "A1030", name: "Plinth beams and DPC", duration: 10, trade: "concrete", preds: [["A1020"]] },
    { code: "A1040", name: "Backfill and plinth protection", duration: 6, trade: "earthworks", preds: [["A1030"]] },
    { code: "A1050", name: "Ground-floor columns", duration: 12, trade: "concrete", preds: [["A1030"]] },
    { code: "A1060", name: "Ground-floor slab: shuttering and steel", duration: 15, trade: "concrete", preds: [["A1050"]] },
    { code: "A1070", name: "Ground-floor slab: casting and curing", duration: 8, trade: "concrete", preds: [["A1060"]] },
    { code: "A1080", name: "First-floor columns", duration: 12, trade: "concrete", preds: [["A1070"]] },
    { code: "A1090", name: "Roof slab: shuttering and steel", duration: 15, trade: "concrete", preds: [["A1080"]] },
    { code: "A1100", name: "Roof slab: casting and curing", duration: 8, trade: "concrete", preds: [["A1090"]] },
    { code: "A1110", name: "Ground-floor brickwork", duration: 20, trade: "masonry", preds: [["A1070"]] },
    { code: "A1120", name: "First-floor brickwork", duration: 20, trade: "masonry", preds: [["A1100"], ["A1110"]] },
    { code: "A1130", name: "Electrical conduits and wiring", duration: 28, trade: "mep", preds: [["A1110", "SS", 8]] },
    { code: "A1140", name: "Plumbing and sanitary lines", duration: 22, trade: "mep", preds: [["A1110", "SS", 8]] },
    { code: "A1150", name: "Plaster, inside and out", duration: 28, trade: "finishes", preds: [["A1120", "SS", 8], ["A1120", "FF", 6]] },
    { code: "A1160", name: "Roof waterproofing", duration: 8, trade: "finishes", preds: [["A1100", "FS", 10]] },
    { code: "A1170", name: "Flooring and tiling", duration: 22, trade: "finishes", preds: [["A1150", "SS", 10]] },
    { code: "A1180", name: "Doors, windows and steelwork", duration: 16, trade: "finishes", preds: [["A1150", "SS", 8]] },
    { code: "A1190", name: "Paint and final finishes", duration: 18, trade: "finishes", preds: [["A1170", "SS", 8], ["A1180"]] },
    { code: "A1200", name: "Boundary wall and paving", duration: 30, trade: "external", preds: [["A1040"]] },
    { code: "A1210", name: "Water supply and septic tank", duration: 12, trade: "external", preds: [["A1040"]] },
    { code: "A1220", name: "Electrical fittings and testing", duration: 8, trade: "mep", preds: [["A1190", "SS", 6], ["A1130"]] },
    { code: "A1230", name: "Snagging and handover inspection", duration: 6, trade: "prelims", preds: [["A1190"], ["A1220"], ["A1200"], ["A1210"], ["A1160"], ["A1140"]] },
    { code: "A1240", name: "Practical completion", duration: 0, trade: "milestone", preds: [["A1230"]] },
  ];
}

const holiday = (from: string, to: string): Disruption => ({
  from,
  to,
  factor: 0,
  category: "other",
  party: "none",
  holiday: true,
});

/** Monthly IPCs: [submitted, certified, paid, amount in PKR]. Due 30 days after certification. */
function ipcs(rows: Array<[string, string | null, string | null, number]>): Payment[] {
  return rows.map(([submitted, certified, paid, amount], i) => ({
    id: `ipc-${i + 1}`,
    ipcNumber: i + 1,
    submittedOn: submitted,
    amountClaimedPkr: Math.round(amount * 1.06),
    certifiedOn: certified ?? undefined,
    amountCertifiedPkr: certified ? amount : undefined,
    paidOn: paid ?? undefined,
    amountPaidPkr: paid ? amount : undefined,
  }));
}

export const SCHOOL: DemoSpec = {
  project: {
    id: "demo-school-shujabad",
    name: "Girls Higher Secondary School, Shujabad: academic block",
    code: "SED-MLN-25-014",
    location: "Shujabad, Multan",
    scheduleStart: "2025-03-03",
    setup: {
      project_type: "building",
      client_type: "provincial_government",
      funding_source: "adp",
      funding_secured_pct: 60,
      contract_value_pkr: 185_000_000,
      engineers_estimate_pkr: 192_000_000,
      bidders_count: 6,
      contract_start_date: "2025-03-03",
      original_completion_date: "2025-10-31",
      pec_category: "C4",
      design_status_at_award: "partial",
      province: "punjab",
    },
  },
  activities: building(),
  overrun: { A1150: 1.15, A1170: 1.1 },
  disruptions: [
    holiday("2025-03-31", "2025-04-02"),
    { from: "2025-04-03", to: "2025-04-14", factor: 0.6, category: "crew_shortage", party: "contractor", note: "masons slow to return after Eid" },
    { from: "2025-05-05", to: "2025-06-02", factor: 0, codes: ["A1060"], category: "design_query", party: "consultant", note: "RFI-07 on slab reinforcement" },
    holiday("2025-06-07", "2025-06-09"),
    { from: "2025-07-01", to: "2025-09-15", factor: 0.7, category: "payment_delay", party: "client", note: "IPC 3 and 4 unpaid" },
    { from: "2025-07-10", to: "2025-08-25", factor: 0.6, trades: ["concrete", "masonry", "external", "earthworks"], category: "weather", party: "none", note: "monsoon rain" },
    { from: "2025-08-01", to: "2025-08-20", factor: 0.4, codes: ["A1090"], category: "material_shortage", party: "supplier", note: "16 mm bars not available" },
    holiday("2025-08-14", "2025-08-14"),
    { from: "2025-09-10", to: "2025-10-20", factor: 0.5, codes: ["A1140", "A1210"], category: "variation_order", party: "client", note: "VO-02 washroom block" },
    { from: "2025-10-01", to: "2025-10-25", factor: 0.3, codes: ["A1180"], category: "drawing_delay", party: "consultant", note: "RFI-15 door and window schedule" },
    holiday("2025-11-09", "2025-11-09"),
    holiday("2025-12-25", "2025-12-25"),
  ],
  events: [
    { eventDate: "2025-04-03", category: "crew_shortage", responsibleParty: "contractor", description: "Masons slow to return after Eid ul Fitr; 40% of gang on site", daysLost: 4, resolvedOn: "2025-04-14" },
    { eventDate: "2025-05-05", category: "design_query", responsibleParty: "consultant", description: "Ground-floor slab reinforcement unclear at beam-column junctions", reference: "RFI-07", activityCode: "A1060", resolvedOn: "2025-06-02" },
    { eventDate: "2025-05-19", category: "design_query", responsibleParty: "consultant", description: "Reminder sent: RFI-07 still unanswered, slab shuttering stood down", reference: "Letter C-088", activityCode: "A1060", resolvedOn: "2025-06-02" },
    { eventDate: "2025-07-01", category: "payment_delay", responsibleParty: "client", description: "IPC 3 not paid; department awaiting ADP release", reference: "Letter C-114", resolvedOn: "2025-09-15" },
    { eventDate: "2025-07-14", category: "weather", responsibleParty: "none", description: "Heavy rain; concrete work stopped", daysLost: 3 },
    { eventDate: "2025-07-28", category: "weather", responsibleParty: "none", description: "Rain and waterlogging at site", daysLost: 2 },
    { eventDate: "2025-08-01", category: "material_shortage", responsibleParty: "supplier", description: "16 mm steel bars unavailable at quoted rate", activityCode: "A1090", resolvedOn: "2025-08-20" },
    { eventDate: "2025-08-04", category: "payment_delay", responsibleParty: "client", description: "IPC 4 certified but unpaid; notice of late payment issued", reference: "Letter C-131", resolvedOn: "2025-09-15" },
    { eventDate: "2025-08-11", category: "weather", responsibleParty: "none", description: "Monsoon spell; brickwork and curing disrupted", daysLost: 4 },
    { eventDate: "2025-08-18", category: "weather", responsibleParty: "none", description: "Rain", daysLost: 2 },
    { eventDate: "2025-09-10", category: "variation_order", responsibleParty: "client", description: "Additional washroom block instructed by the department", reference: "VO-02", activityCode: "A1140", resolvedOn: "2025-10-20" },
    { eventDate: "2025-10-01", category: "drawing_delay", responsibleParty: "consultant", description: "Revised door and window schedule awaited", reference: "RFI-15", activityCode: "A1180", resolvedOn: "2025-10-25" },
  ],
  payments: ipcs([
    ["2025-03-31", "2025-04-12", "2025-05-08", 9_400_000],
    ["2025-04-30", "2025-05-13", "2025-06-20", 14_800_000],
    ["2025-05-31", "2025-06-14", "2025-09-15", 17_200_000],
    ["2025-06-30", "2025-07-14", "2025-09-15", 19_600_000],
    ["2025-07-31", "2025-08-13", "2025-10-02", 16_100_000],
    ["2025-08-31", "2025-09-12", "2025-10-20", 18_300_000],
    ["2025-09-30", "2025-10-14", "2025-11-25", 21_700_000],
    ["2025-10-31", "2025-11-13", "2025-12-20", 19_900_000],
    ["2025-11-30", "2025-12-12", "2026-01-28", 17_400_000],
    ["2025-12-31", "2026-01-14", "2026-02-25", 15_800_000],
  ]),
};

export const ROAD: DemoSpec = {
  project: {
    id: "demo-road-hasilpur",
    name: "Hasilpur–Chishtian road rehabilitation, 18 km",
    code: "CW-BWP-26-031",
    location: "Hasilpur, Bahawalpur",
    scheduleStart: "2026-03-02",
    setup: {
      project_type: "road",
      client_type: "provincial_government",
      funding_source: "adp",
      funding_secured_pct: 45,
      contract_value_pkr: 620_000_000,
      engineers_estimate_pkr: 756_000_000,
      bidders_count: 3,
      contract_start_date: "2026-03-02",
      original_completion_date: "2026-11-28",
      pec_category: "C3",
      design_status_at_award: "complete",
      province: "punjab",
    },
  },
  activities: [
    { code: "R100", name: "Mobilisation and camp", duration: 10, trade: "prelims" },
    { code: "R110", name: "Survey and setting out", duration: 8, trade: "survey", preds: [["R100"]] },
    { code: "R120", name: "Clearing and grubbing", duration: 12, trade: "earthworks", preds: [["R110", "SS", 4]] },
    { code: "R130", name: "Earthworks and embankment, km 0–9", duration: 50, trade: "earthworks", preds: [["R120", "SS", 6]] },
    { code: "R140", name: "Earthworks and embankment, km 9–18", duration: 50, trade: "earthworks", preds: [["R130", "SS", 15]] },
    { code: "R150", name: "Box culverts (6 nos)", duration: 60, trade: "concrete", preds: [["R120"]] },
    { code: "R160", name: "Subgrade preparation, km 0–9", duration: 26, trade: "earthworks", preds: [["R130", "SS", 12], ["R130", "FF", 4]] },
    { code: "R170", name: "Subgrade preparation, km 9–18", duration: 26, trade: "earthworks", preds: [["R140", "SS", 12], ["R140", "FF", 4]] },
    { code: "R180", name: "Sub-base course", duration: 45, trade: "pavement", preds: [["R160", "SS", 6], ["R170", "SS", 8], ["R150"]] },
    { code: "R190", name: "Water-bound macadam base", duration: 45, trade: "pavement", preds: [["R180", "SS", 10]] },
    { code: "R200", name: "Prime coat", duration: 12, trade: "pavement", preds: [["R190", "SS", 12], ["R190", "FF", 2]] },
    { code: "R210", name: "Asphalt wearing course", duration: 36, trade: "asphalt", preds: [["R200", "SS", 3], ["R200", "FF", 3]] },
    { code: "R220", name: "Shoulders and side drains", duration: 40, trade: "earthworks", preds: [["R190", "SS", 10]] },
    { code: "R230", name: "Road furniture and signs", duration: 18, trade: "finishes", preds: [["R210", "SS", 10]] },
    { code: "R240", name: "Road markings", duration: 12, trade: "finishes", preds: [["R210"]] },
    { code: "R250", name: "Testing and handover", duration: 6, trade: "prelims", preds: [["R230"], ["R240"], ["R220"]] },
    { code: "R260", name: "Completion", duration: 0, trade: "milestone", preds: [["R250"]] },
  ],
  overrun: { R130: 1.1, R140: 1.05 },
  disruptions: [
    holiday("2026-03-20", "2026-03-22"),
    holiday("2026-03-23", "2026-03-23"),
    { from: "2026-04-15", to: "2026-06-30", factor: 0.25, codes: ["R150"], category: "utility_shifting", party: "authority", note: "MEPCO poles and PTCL cable at culvert sites" },
    { from: "2026-05-10", to: "2026-06-20", factor: 0.5, codes: ["R140"], category: "site_access", party: "client", note: "land dispute at km 12–14" },
    holiday("2026-05-27", "2026-05-29"),
    { from: "2026-07-05", to: "2026-08-31", factor: 0.7, trades: ["earthworks", "pavement", "concrete"], category: "weather", party: "none", note: "monsoon rain" },
    { from: "2026-08-17", to: "2026-12-31", factor: 0.85, category: "payment_delay", party: "client", note: "IPC 4 and 5 unpaid" },
    holiday("2026-08-14", "2026-08-14"),
    { from: "2026-09-21", to: "2026-12-31", factor: 0.4, codes: ["R150"], category: "design_query", party: "consultant", note: "RFI-21 culvert C-4 level" },
  ],
  events: [
    { eventDate: "2026-04-15", category: "utility_shifting", responsibleParty: "authority", description: "MEPCO poles and PTCL cable in the way at four culvert sites", reference: "Letter HC-019", activityCode: "R150", resolvedOn: "2026-06-30" },
    { eventDate: "2026-05-10", category: "site_access", responsibleParty: "client", description: "Land dispute stops embankment work at km 12–14", reference: "Letter HC-027", activityCode: "R140", resolvedOn: "2026-06-20" },
    { eventDate: "2026-06-08", category: "utility_shifting", responsibleParty: "authority", description: "Reminder to MEPCO: shifting estimate still not issued", reference: "Letter HC-034", activityCode: "R150", resolvedOn: "2026-06-30" },
    { eventDate: "2026-07-13", category: "weather", responsibleParty: "none", description: "Heavy rain; embankment compaction stopped", daysLost: 3 },
    { eventDate: "2026-07-27", category: "weather", responsibleParty: "none", description: "Rain; sub-base trial stretch washed out", daysLost: 4 },
    { eventDate: "2026-08-10", category: "weather", responsibleParty: "none", description: "Monsoon spell", daysLost: 3 },
    { eventDate: "2026-08-17", category: "payment_delay", responsibleParty: "client", description: "IPC 4 overdue; notice of late payment issued", reference: "Letter HC-052", resolvedOn: undefined },
    { eventDate: "2026-09-21", category: "design_query", responsibleParty: "consultant", description: "Culvert C-4 invert level conflicts with canal crossing", reference: "RFI-21", activityCode: "R150" },
    { eventDate: "2026-09-28", category: "weather", responsibleParty: "none", description: "Late rain", daysLost: 1 },
  ],
  payments: ipcs([
    ["2026-03-31", "2026-04-13", "2026-05-06", 21_500_000],
    ["2026-04-30", "2026-05-14", "2026-06-17", 38_200_000],
    ["2026-05-31", "2026-06-13", "2026-07-16", 44_900_000],
    ["2026-06-30", "2026-07-14", null, 41_300_000],
    ["2026-07-31", "2026-08-13", null, 36_800_000],
    ["2026-08-31", "2026-09-12", null, 33_400_000],
    ["2026-09-30", null, null, 39_700_000],
  ]),
  cutoff: "2026-10-12",
};

export const CLINIC: DemoSpec = {
  project: {
    id: "demo-clinic-lahore",
    name: "Family clinic and pharmacy, DHA Phase 9",
    code: "PVT-LHR-26-007",
    location: "Lahore",
    scheduleStart: "2026-06-01",
    setup: {
      project_type: "building",
      client_type: "private",
      funding_source: "own_funds",
      funding_secured_pct: 100,
      contract_value_pkr: 95_000_000,
      engineers_estimate_pkr: 98_000_000,
      bidders_count: 5,
      contract_start_date: "2026-06-01",
      original_completion_date: "2027-02-27",
      pec_category: "C5",
      design_status_at_award: "complete",
      province: "punjab",
    },
  },
  activities: building().map((a) => ({
    ...a,
    code: a.code.replace("A", "C"),
    preds: a.preds?.map(([c, t, l]) => [c.replace("A", "C"), t, l] as [string, typeof t, typeof l]),
  })),
  overrun: { C1020: 0.95, C1060: 0.95 },
  disruptions: [
    { from: "2026-07-05", to: "2026-08-31", factor: 0.85, trades: ["concrete", "masonry", "earthworks"], category: "weather", party: "none", note: "monsoon rain" },
    holiday("2026-08-14", "2026-08-14"),
  ],
  events: [
    { eventDate: "2026-07-20", category: "weather", responsibleParty: "none", description: "Rain; slab curing extended", daysLost: 2 },
    { eventDate: "2026-08-24", category: "weather", responsibleParty: "none", description: "Rain", daysLost: 1 },
  ],
  payments: ipcs([
    ["2026-06-30", "2026-07-08", "2026-07-20", 6_800_000],
    ["2026-07-31", "2026-08-07", "2026-08-21", 9_100_000],
    ["2026-08-31", "2026-09-08", "2026-09-22", 10_400_000],
    ["2026-09-30", "2026-10-08", null, 11_200_000],
  ]),
  cutoff: "2026-10-12",
};

export const DEMO_SPECS = [ROAD, CLINIC, SCHOOL];
