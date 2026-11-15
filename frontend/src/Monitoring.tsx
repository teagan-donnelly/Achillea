import type { Device, State, Vital } from "./types";
import { words, time } from "./api";
export const STALE_AFTER_MINUTES = 15; // Display freshness only; not a clinical alert threshold.
export function orderedReadings(values: Vital[]) {
  return values
    .filter((v) => Number.isFinite(Date.parse(v.observedAt)))
    .slice()
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
}
export function latestReadings(values: Vital[]) {
  const sorted = orderedReadings(values);
  return Array.from(new Set(sorted.map((v) => v.metric))).map((metric) =>
    sorted.filter((v) => v.metric === metric).at(-1)!,
  );
}
export function readingState(v: Vital, device?: Device) {
  if (v.quality === "MISSING" || !Number.isFinite(v.value))
    return "Unavailable";
  if (v.quality.includes("DISCONNECTED")) return "Disconnected";
  if (device?.connectionState === "DISCONNECTED") return "Disconnected";
  if (device?.freshness === "UNKNOWN") return "Signal unavailable";
  if (!Number.isFinite(Date.parse(v.observedAt))) return "Time unavailable";
  if (
    device?.freshness === "STALE" ||
    Date.now() - Date.parse(v.observedAt) >
      (device ? staleAfterMs(device) : STALE_AFTER_MINUTES * 60000)
  )
    return "Old reading";
  if (device?.connectionState === "DELAYED" || v.quality === "DELAYED")
    return "Delayed reading";
  if (v.quality !== "VALID") return "Check signal quality";
  return "Recent reading";
}
/** Recorded replay monitors report on the recording's cadence (backend sets the interval). */
export function isReplayDevice(device?: Device) {
  return !!device?.mode && (device.mode.startsWith("RECORDED") || device.mode === "SYNTHETIC_FIXTURE");
}
function staleAfterMs(device: Device) {
  return isReplayDevice(device) ? Math.max(60000, (device.updateIntervalSeconds ?? 6) * 5000) : 60000;
}
export function patientMonitor(state: State, patientId: string) {
  return state.devices?.find(
    (d) => d.patientId === patientId && d.bodyRegion === "BEDSIDE_MONITOR",
  );
}
export function DeviceStatus({
  device,
  compact = false,
}: {
  device?: Device;
  compact?: boolean;
}) {
  if (!device) return null;
  return (
    <p
      className={`monitor-status ${compact ? "compact" : ""}`}
      aria-label="Monitor availability"
    >
      Monitor: {words(device.connectionState)} · {words(device.freshness)} ·
      simulated
      {!compact && (
        <small>
          {" "}
          Sampled{" "}
          {device.lastSampledAt ? time(device.lastSampledAt) : "unknown"} ·
          received {device.lastSeenAt ? time(device.lastSeenAt) : "unknown"}
        </small>
      )}
    </p>
  );
}
export function freshness(v: Vital) {
  const elapsed = Date.now() - Date.parse(v.observedAt);
  if (!Number.isFinite(elapsed)) return "Time unavailable";
  if (elapsed < 0) return "Future timestamp";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Less than 1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440)
    return `${Math.floor(minutes / 60)} hr ${minutes % 60} min ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}
export function metricName(metric: string) {
  return (
    (
      {
        HEART_RATE: "Heart rate",
        SPO2: "Oxygen saturation",
        TEMPERATURE: "Temperature",
        RESPIRATORY_RATE: "Respiratory rate",
        BLOOD_PRESSURE_SYSTOLIC: "Systolic BP",
        BLOOD_PRESSURE_DIASTOLIC: "Diastolic BP",
      } as Record<string, string>
    )[metric] ?? words(metric)
  );
}
export function sourceName(v: Vital) {
  if (v.source.startsWith("RECORDED")) return "Recorded data replay (MIMIC-IV demo)";
  if (v.source === "SYNTHETIC_FIXTURE") return "Recorded data replay (synthetic fixture)";
  return v.source.includes("SIMULATED") ? "Simulated monitor" : words(v.source);
}
export function Trend({
  readings,
  compact = false,
}: {
  readings: Vital[];
  compact?: boolean;
}) {
  const all = orderedReadings(readings).slice(-30),
    valid = all.filter(
      (v) => v.quality === "VALID" && Number.isFinite(v.value),
    );
  if (valid.length < 2)
    return (
      <small className="trend-empty">
        Trend unavailable - fewer than two valid readings
      </small>
    );
  const lo = Math.min(...valid.map((v) => v.value)),
    hi = Math.max(...valid.map((v) => v.value)),
    first = Date.parse(all[0].observedAt),
    last = Date.parse(all.at(-1)!.observedAt);
  const point = (v: Vital) =>
    `${8 + ((Date.parse(v.observedAt) - first) / Math.max(last - first, 1)) * 284},${50 - ((v.value - lo) / Math.max(hi - lo, 1)) * 34}`;
  const segments: Vital[][] = [];
  let current: Vital[] = [];
  for (const v of all) {
    if (v.quality === "VALID" && Number.isFinite(v.value)) {
      current.push(v);
    } else {
      if (current.length) segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);
  const label = `${metricName(valid[0].metric)} historical trend: ${valid.length} valid readings, ${lo} to ${hi} ${valid[0].unit}, ${time(all[0].observedAt)} to ${time(all.at(-1)!.observedAt)}. Source observations; gaps indicate unavailable or non-valid samples.`;
  return (
    <div className={compact ? "trend-chart mini" : "trend-chart"} data-no-swipe>
      <svg viewBox="0 0 300 64" role="img" aria-label={label}>
        <path d="M8 52H292" className="chart-baseline" />
        {segments.map((segment, i) => (
          <polyline
            key={i}
            points={segment.map(point).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          />
        ))}
        {valid.map((v) => {
          const [cx, cy] = point(v).split(",");
          return (
            <circle key={v.id} cx={cx} cy={cy} r="2.5" fill="currentColor" />
          );
        })}
      </svg>
      <div className="trend-caption">
        <span>{time(all[0].observedAt)}</span>
        <span>
          {compact
            ? "Recorded history"
            : `${lo}–${hi} ${valid[0].unit} · ${valid.length} readings`}
        </span>
        <span>{time(all.at(-1)!.observedAt)}</span>
      </div>
      {!compact && (
        <details>
          <summary>View recorded values</summary>
          <div className="reading-history">
            {all.map((v) => (
              <p key={v.id}>
                <time dateTime={v.observedAt}>{time(v.observedAt)}</time>
                <strong>
                  {v.quality === "VALID"
                    ? `${v.value} ${v.unit}`
                    : words(v.quality)}
                </strong>
                <span>{sourceName(v)}</span>
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
