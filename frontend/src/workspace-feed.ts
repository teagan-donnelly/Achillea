import { api } from "./api";
import type { ActivityItem, MonitoringUpdates, Round, State } from "./types";

export interface WorkspaceSnapshot {
  unit: string;
  state: State;
  rounds: Round[];
  activity: ActivityItem[];
  nextSince: string;
}
export function mergeEvidence<T extends { id: string }>(
  previous: T[],
  incoming: T[],
): T[] {
  return [
    ...new Map(
      [...previous, ...incoming].map((item) => [item.id, item]),
    ).values(),
  ];
}
export async function loadWorkspace(
  unit: string,
  previous?: WorkspaceSnapshot | null,
): Promise<WorkspaceSnapshot> {
  const state = await api<State>(`/workspace?unit=${unit}`);
  const prior =
    previous?.unit === unit &&
    previous.state.demoStartedAt === state.demoStartedAt
      ? previous
      : null;
  const [updates, rounds, activity] = await Promise.all([
    api<MonitoringUpdates>(
      `/monitoring/updates?unit=${unit}${prior ? `&since=${encodeURIComponent(prior.nextSince)}` : ""}`,
    ),
    api<Round[]>(`/rounds?unit=${unit}`),
    api<ActivityItem[]>(`/activity/summary?unit=${unit}`),
  ]);
  const old = prior?.state;
  state.vitals = mergeEvidence(old?.vitals ?? [], updates.measurements).sort(
    (a, b) =>
      Date.parse(a.observedAt) - Date.parse(b.observedAt) ||
      a.id.localeCompare(b.id),
  );
  state.samples = mergeEvidence(
    old?.samples ?? [],
    updates.orientationSamples,
  ).sort(
    (a, b) =>
      Date.parse(a.capturedAt) - Date.parse(b.capturedAt) ||
      a.id.localeCompare(b.id),
  );
  state.events = mergeEvidence(old?.events ?? [], updates.events).sort(
    (a, b) =>
      Date.parse(a.timestamp) - Date.parse(b.timestamp) ||
      a.id.localeCompare(b.id),
  );
  state.devices = updates.devices;
  state.serverTime = updates.serverTime;
  return { unit, state, rounds, activity, nextSince: updates.nextSince };
}
