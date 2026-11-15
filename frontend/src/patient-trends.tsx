// Trends tab: one swipeable graph card per measured metric, over 24H / 7D / Full stay.
// Data: useSeries (server-side buckets over persisted history, or the honest "latest 500 readings"
// fallback). Lines break at gaps; nothing is interpolated.
import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { Patient, State } from "./types";
import { metricName } from "./Monitoring";
import { rangeBounds, useSeries, type Series, type SeriesPoint, type SeriesRange } from "./series";
import { EmptyState, Segmented } from "./ui";
import { clock, stayStart } from "./patient-data";

const ORDER = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "TEMPERATURE"];
const RANGES: { value: SeriesRange; label: string }[] = [
  { value: "24H", label: "24H" },
  { value: "7D", label: "7D" },
  { value: "STAY", label: "Full stay" },
];

const fmt = (metric: string, v: number) => (metric === "TEMPERATURE" ? v.toFixed(1) : String(Math.round(v)));
const shortUnit = (u: string) => (u === "breaths/min" ? "/min" : u);

export function PatientTrends({ state, patient, now }: { state: State; patient: Patient; now: number }) {
  const [range, setRange] = useState<SeriesRange>("24H");
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const metrics = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of state.vitals) if (v.patientId === patient.id && !seen.has(v.metric)) seen.set(v.metric, v.unit);
    return [...seen.keys()].sort(
      (a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
    );
  }, [state.vitals, patient.id]);
  const start = stayStart(state, patient.id);
  const bounds = rangeBounds(range, Math.floor(now / 60000) * 60000, start);
  const revision = (state.serverTime ?? "").slice(0, 16);

  const go = (i: number) => {
    const el = track.current?.children[i] as HTMLElement | undefined;
    el?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "start" });
  };

  return (
    <section className="pt-trends" aria-label="Measurement trends">
      <div className="pt-range">
        <Segmented label="Trend range" options={RANGES} value={range} onChange={setRange} />
      </div>
      {range === "STAY" && (
        <p className="pt-range-note">
          Available measurement history
        </p>
      )}
      {!metrics.length ? (
        <EmptyState title="No measurements yet" />
      ) : (
        <>
          <div
            className="pt-cards"
            ref={track}
            data-no-swipe
            onScroll={(e) => {
              const el = e.currentTarget;
              const w = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
              setIndex(Math.max(0, Math.min(metrics.length - 1, Math.round(el.scrollLeft / (w + 12)))));
            }}
          >
            {metrics.map((m) => (
              <TrendCard
                key={m}
                patientId={patient.id}
                metric={m}
                from={bounds.from}
                to={bounds.to}
                revision={revision}
                fullStay={range === "STAY"}
              />
            ))}
          </div>
          {metrics.length > 1 && (
            <div className="pt-pager" role="group" aria-label="Choose measurement">
              {metrics.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  aria-label={metricName(m)}
                  aria-current={i === index}
                  onClick={() => go(i)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TrendCard({
  patientId,
  metric,
  from,
  to,
  revision,
  fullStay,
}: {
  patientId: string;
  metric: string;
  from: string;
  to: string;
  revision: string;
  fullStay: boolean;
}) {
  const loaded = useSeries(patientId, metric, from, to, revision, fullStay);
  // Treat a malformed response as unavailable rather than plotting it.
  const series = loaded.series && Array.isArray(loaded.series.points) ? loaded.series : null;
  const error = loaded.error ?? (loaded.series && !series ? "invalid" : null);
  const loading = loaded.loading;
  const pts = (series?.points ?? []).filter((p) =>
    Number.isFinite(p.value) && Number.isFinite(p.min) && Number.isFinite(p.max) &&
    Number.isFinite(p.count) && p.count > 0 && Number.isFinite(Date.parse(p.t))
  ).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const unit = shortUnit(series?.unit ?? "");
  const min = pts.length ? Math.min(...pts.map((p) => p.min)) : null;
  const max = pts.length ? Math.max(...pts.map((p) => p.max)) : null;
  const count = pts.reduce((sum, p) => sum + p.count, 0);
  const avg = count ? pts.reduce((sum, p) => sum + p.value * p.count, 0) / count : null;
  return (
    <article className="pt-card" aria-label={`${metricName(metric)} trend`}>
      <header className="pt-card-head">
        <p className="pt-card-value">
          <span className="pt-card-cap">Average</span>
          <strong>{avg !== null ? fmt(metric, avg) : "–"}</strong>
          {avg !== null && <span className="pt-card-unit">{unit}</span>}
        </p>
        <h3>
          {metricName(metric)}
          {min !== null && max !== null && (
            <span>
              {" · "}
              {fmt(metric, min) === fmt(metric, max) ? "Steady" : `${fmt(metric, min)}–${fmt(metric, max)}`}
            </span>
          )}
        </h3>
      </header>
      {series && pts.length > 0 ? (
        <Chart series={{ ...series, points: pts }} metric={metric} unit={unit} />
      ) : (
        <div className="pt-chart-empty">
          {error ? "History unavailable" : loading || !series ? "Loading…" : "No readings in this range"}
        </div>
      )}
      {series && <Coverage series={series} fullStay={fullStay} />}
    </article>
  );
}

function Coverage({ series, fullStay }: { series: Series; fullStay: boolean }) {
  if (series.coverage === "recent-500") return <p className="pt-card-note">Partial history · latest 500 readings</p>;
  return fullStay && series.firstObservedAt ? (
    <p className="pt-card-note">Stored measurements since {new Date(series.firstObservedAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</p>
  ) : null;
}

/** Nice-ish y ticks around the data. */
function ticks(lo: number, hi: number) {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const out: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** Times when the plotted span is under ~a day and a half, dates beyond that. */
function xLabel(t: number, span: number) {
  return span < 36 * 3600000
    ? clock(new Date(t).toISOString())
    : new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
}

function Chart({ series, metric, unit }: { series: Series; metric: string; unit: string }) {
  const [hover, setHover] = useState<SeriesPoint | null>(null);
  const W = 320,
    H = 168,
    L = 34,
    R = 8,
    T = 10,
    B = 24;
  const pts = series.points;
  // Start the axis where this patient’s data starts, so a short stay is not a mostly empty plot.
  const t0 = Math.max(Date.parse(series.from), Math.min(...pts.map((p) => Date.parse(p.t)))),
    t1 = Date.parse(series.to);
  const lo = Math.min(...pts.map((p) => p.min)),
    hi = Math.max(...pts.map((p) => p.max));
  // A flat series gets a flat line, not an invented axis around it.
  const steady = fmt(metric, lo) === fmt(metric, hi);
  const yt = ticks(Math.min(...pts.map((p) => p.min)), Math.max(...pts.map((p) => p.max)));
  const y0 = yt[0]!,
    y1 = yt.at(-1)!;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - y0) / Math.max(1e-9, y1 - y0)) * (H - T - B);
  const gap = series.bucketMinutes * 60000 * 1.5;
  // Split into runs of consecutive buckets: a missing bucket breaks the line.
  const runs: SeriesPoint[][] = [];
  for (const p of pts) {
    const run = runs.at(-1);
    const prev = run?.at(-1);
    if (run && prev && Date.parse(p.t) - Date.parse(prev.t) <= gap) run.push(p);
    else runs.push([p]);
  }
  const mid = series.bucketMinutes * 30000; // plot at bucket centre
  const px = (p: SeriesPoint) => x(Math.min(t1, Date.parse(p.t) + mid));
  const xt = [t0, t0 + (t1 - t0) / 2, t1];

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    let best: SeriesPoint | null = null;
    for (const p of pts) if (!best || Math.abs(px(p) - sx) < Math.abs(px(best) - sx)) best = p;
    setHover(best);
  };

  return (
    <div className="pt-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${metricName(metric)} from ${new Date(t0).toLocaleString()} to ${new Date(t1).toLocaleString()}, ${pts.length} averaged points${runs.length > 1 ? `, ${runs.length - 1} gap${runs.length > 2 ? "s" : ""} with no readings` : ""}`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {!steady && yt.map((v) => (
          <g key={v}>
            <line className="pt-grid" x1={L} x2={W - R} y1={y(v)} y2={y(v)} />
            <text className="pt-axis" x={L - 6} y={y(v) + 3.5} textAnchor="end">
              {fmt(metric, v)}
            </text>
          </g>
        ))}
        {xt.map((t, i) => (
          <text
            key={t}
            className="pt-axis"
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          >
            {xLabel(t, t1 - t0)}
          </text>
        ))}
        {runs.map((run, i) =>
          run.length > 1 ? (
            <g key={i}>
              <path
                className="pt-band"
                d={`M${run.map((p) => `${px(p)},${y(p.max)}`).join("L")}L${run
                  .slice()
                  .reverse()
                  .map((p) => `${px(p)},${y(p.min)}`)
                  .join("L")}Z`}
              />
              <path className="pt-line" d={`M${run.map((p) => `${px(p)},${y(p.value)}`).join("L")}`} />
            </g>
          ) : (
            <circle key={i} className="pt-solo" cx={px(run[0]!)} cy={y(run[0]!.value)} r={2.5} />
          ),
        )}
        {hover && (
          <g className="pt-hover">
            <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} />
            <circle cx={px(hover)} cy={y(hover.value)} r={4} />
          </g>
        )}
      </svg>
      <p className="pt-tooltip" aria-live="polite">
        {hover ? (
          <>
            <strong>
              {fmt(metric, hover.value)} {unit}
            </strong>{" "}
            avg · {clock(hover.t)} · {hover.count} reading{hover.count === 1 ? "" : "s"}
            {hover.min !== hover.max && ` · ${fmt(metric, hover.min)}–${fmt(metric, hover.max)}`}
          </>
        ) : (
          " "
        )}
      </p>
    </div>
  );
}
