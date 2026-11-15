// Props every top-level tab screen receives from App.tsx. All data here is the live simulation
// state (polled + pushed over /api/stream); screens must not fetch or invent patient data
// beyond the existing /api endpoints.
import type { ActivityItem, Chart, Patient, Round, State, Task } from "./types";

export type Mutate = (
  path: string,
  body?: unknown,
  method?: string,
) => Promise<Chart | State | Task>;

export interface ScreenProps {
  /** Live simulation state for the selected unit (patients, vitals, samples, devices, tasks, charts, movements, events). */
  state: State;
  /** Patients assigned to the demo nurse in the selected unit. */
  patients: Patient[];
  /** Server-ranked task queue (GET /api/rounds) for the selected unit. */
  rounds: Round[];
  /** Grouped activity (GET /api/activity/summary). */
  activity: ActivityItem[];
  unit: string;
  label: string;
  /** POST/PATCH to the backend, then refresh state. Shows a toast on error. */
  mutate: Mutate;
  busy: boolean;
  refresh: () => Promise<void>;
  selectUnit: (unit: string, destination?: string) => void;
}
