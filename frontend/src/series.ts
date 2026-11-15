// Historical measurement series for graphs (Monitoring 24h, Patients Trends 24H / 7D / Full stay).
// Source of truth: the backend's persisted readings. Uses GET /api/patients/{id}/vitals/series when
// available (server-side bucketing over the full history), and falls back to the existing
// GET /api/patients/{id}/vitals endpoint (max 500 most recent readings) with client-side bucketing.
// Never interpolates: buckets without valid readings are simply absent, so charts show gaps.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Vital } from "./types";

export type SeriesRange = "6H" | "12H" | "24H" | "7D" | "STAY";

export interface SeriesPoint {
  /** Bucket start (ISO). */
  t: string;
  /** Mean of valid readings in the bucket. */
  value: number;
  min: number;
  max: number;
  count: number;
}

export interface Series {
  patientId: string;
  metric: string;
  unit: string;
  from: string;
  to: string;
  bucketMinutes: number;
  points: SeriesPoint[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  totalReadings: number;
  /** "server" = full persisted history; "recent-500" = fallback limited to the latest 500 readings. */
  coverage: "server" | "recent-500";
}

const HOUR = 3600_000;

export function rangeBounds(range: SeriesRange, now: number, stayStart?: string | null) {
  const to = now;
  const from =
    range === "6H"
      ? now - 6 * HOUR
      : range === "12H"
        ? now - 12 * HOUR
        : range === "24H"
      ? now - 24 * HOUR
      : range === "7D"
        ? now - 7 * 24 * HOUR
        : stayStart
          ? Date.parse(stayStart)
          : now - 30 * 24 * HOUR;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

/** Bucket so a chart has about 96 points at most. */
export function bucketMinutesFor(fromIso: string, toIso: string) {
  const minutes = Math.max(1, (Date.parse(toIso) - Date.parse(fromIso)) / 60000);
  return Math.max(1, Math.ceil(minutes / 96));
}

export function bucketReadings(readings: Vital[], fromIso: string, toIso: string, bucketMinutes: number) {
  const from = Date.parse(fromIso),
    to = Date.parse(toIso),
    size = bucketMinutes * 60000;
  const buckets = new Map<number, number[]>();
  for (const r of readings) {
    const t = Date.parse(r.observedAt);
    if (!Number.isFinite(t) || t < from || t > to) continue;
    if (r.quality !== "VALID" || !Number.isFinite(r.value)) continue;
    const key = from + Math.floor((t - from) / size) * size;
    const list = buckets.get(key) ?? [];
    list.push(r.value);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, values]) => ({
      t: new Date(key).toISOString(),
      value: values.reduce((a, b) => a + b, 0) / values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      count: values.length,
    }));
}

async function loadSeries(patientId: string, metric: string, from: string, to: string, fullStay = false): Promise<Series> {
  const bucketMinutes = bucketMinutesFor(from, to);
  const q = `metric=${encodeURIComponent(metric)}&to=${encodeURIComponent(to)}&${fullStay ? "fullStay=true" : `from=${encodeURIComponent(from)}&bucketMinutes=${bucketMinutes}`}`;
  try {
    const s = await api<Omit<Series, "coverage">>(`/patients/${encodeURIComponent(patientId)}/vitals/series?${q}`);
    return { ...s, coverage: "server" };
  } catch {
    const readings = await api<Vital[]>(
      `/patients/${encodeURIComponent(patientId)}/vitals?metric=${encodeURIComponent(metric)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=500`,
    );
    const valid = readings.filter((r) => Number.isFinite(Date.parse(r.observedAt)));
    const times = valid.map((r) => r.observedAt).sort();
    const fallbackFrom = fullStay ? times[0] ?? to : from;
    const fallbackBucketMinutes = bucketMinutesFor(fallbackFrom, to);
    return {
      patientId,
      metric,
      unit: readings[0]?.unit ?? "",
      from: fallbackFrom,
      to,
      bucketMinutes: fallbackBucketMinutes,
      points: bucketReadings(readings, fallbackFrom, to, fallbackBucketMinutes),
      firstObservedAt: times[0] ?? null,
      lastObservedAt: times.at(-1) ?? null,
      totalReadings: valid.length,
      coverage: "recent-500",
    };
  }
}

/**
 * Loads a series and reloads when inputs change or `revision` changes (pass something that changes
 * when new data arrives, e.g. state.serverTime, to keep graphs live).
 */
export function useSeries(
  patientId: string | undefined,
  metric: string,
  from: string,
  to: string,
  revision?: unknown,
  fullStay = false,
) {
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Round the window to the minute so live revisions do not refetch on every second.
  const fromKey = from.slice(0, 16),
    toKey = to.slice(0, 16);
  useEffect(() => {
    if (!patientId) return;
    let active = true;
    setLoading(true);
    setSeries(null);
    setError(null);
    loadSeries(patientId, metric, fullStay ? "1970-01-01T00:00:00.000Z" : from, to, fullStay)
      .then((s) => {
        if (active) {
          setSeries(s);
          setError(null);
        }
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "History unavailable"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, metric, fromKey, toKey, revision, fullStay]);
  return { series, error, loading };
}
