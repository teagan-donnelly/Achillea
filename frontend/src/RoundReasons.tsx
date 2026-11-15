import { words } from "./api";
export const REASON_LABELS: Record<string, string> = {
  EXPLICIT_HIGH_PRIORITY: "Explicit high workflow priority",
  EXPLICIT_TIMELY_PRIORITY: "Explicit timely workflow priority",
  SCHEDULED_DUE: "Scheduled review is due",
  SCHEDULED_OVERDUE: "Scheduled review time has passed",
  DUE_WITHIN_30_MINUTES: "Due within 30 minutes",
  ROUTINE_SEQUENCE: "Routine future sequence",
  NURSE_ACKNOWLEDGED: "Acknowledged by the nurse",
  NURSE_DEFERRED: "Deferred with a nurse-supplied reason",
  SENSOR_REVIEW_REQUIRED: "Movement evidence requires review",
  TECHNICAL_DEVICE_REVIEW: "Technical device review",
  DEVICE_CONNECTION_REVIEW: "Device connection awaits review",
};
/** Human label for a backend reason code (falls back to the code in words). */
export const reasonLabel = (code: string) => REASON_LABELS[code] ?? words(code);
export function RoundReasons({ codes }: { codes?: string[] }) {
  if (!codes?.length) return null;
  return (
    <details className="round-reasons">
      <summary>Why this task is here</summary>
      <ul>
        {codes.map((code) => (
          <li key={code}>
            {reasonLabel(code)} <small>({code})</small>
          </li>
        ))}
      </ul>
      <p>Workflow timing and technical review, not medical triage.</p>
    </details>
  );
}
