// Shift handoff records (backend: HandoffService). Nurse-authored text only; nothing here is
// generated. Status only moves forward through explicit commands:
// DRAFT -> READY -> REVIEWED -> ACKNOWLEDGED. Opening a handoff never changes its status.

export type HandoffStatus = "DRAFT" | "READY" | "REVIEWED" | "ACKNOWLEDGED";
export type ShiftLabel = "Day" | "Night";

export interface HandoffSections {
  currentConcerns: string;
  changesDuringShift: string;
  interventionsAndResponse: string;
  outstandingFollowUp: string;
  nextShiftPriorities: string;
  additionalObservations: string;
}

export type SectionKey = keyof HandoffSections;

export interface Handoff {
  id: string;
  patientId: string;
  shiftDate: string; // YYYY-MM-DD, the date the shift starts
  shiftLabel: ShiftLabel;
  senderId: string;
  receiverId: string | null;
  status: HandoffStatus;
  sections: HandoffSections;
  version: number;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  patientName?: string;
  room?: string;
  unit?: string;
}

export interface HandoffVersion {
  id: string;
  handoffId: string;
  version: number;
  sections: HandoffSections;
  savedAt: string;
  savedBy: string;
  status: HandoffStatus;
}

export interface HandoffDetail {
  handoff: Handoff;
  versions: HandoffVersion[];
}

/** The six structured note sections, in the order nurses read them. */
export const SECTION_FIELDS: { key: SectionKey; label: string; hint: string }[] = [
  { key: "currentConcerns", label: "Current concerns", hint: "What the next nurse must watch for" },
  { key: "changesDuringShift", label: "Changes during shift", hint: "What is different from the start of your shift" },
  { key: "interventionsAndResponse", label: "Interventions & response", hint: "What you did and how the patient responded" },
  { key: "outstandingFollowUp", label: "Outstanding follow-up", hint: "Results, calls or reviews still pending" },
  { key: "nextShiftPriorities", label: "Next-shift priorities", hint: "What should happen first" },
  { key: "additionalObservations", label: "Additional observations", hint: "Anything else worth knowing" },
];

export const EMPTY_SECTIONS: HandoffSections = {
  currentConcerns: "",
  changesDuringShift: "",
  interventionsAndResponse: "",
  outstandingFollowUp: "",
  nextShiftPriorities: "",
  additionalObservations: "",
};
