import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  Activity,
  ChevronRight,
  ClipboardCheck,
  Droplets,
  HeartPulse,
  Move,
  PenLine,
  RadioTower,
  Thermometer,
  Wind,
} from "lucide-react";
import type { ScreenProps } from "./app-context";
import type { Event, OrientationSample, Patient, State } from "./types";
import { api, words } from "./api";
import {
  Screen,
  ScreenHeader,
  EmptyState,
  Pill,
  Section,
  Segmented,
  type Tone as KitTone,
} from "./ui";
import { useDemoNow } from "./RepositioningViews";
import {
  feedPatient,
  type FeedMeasurement,
  type FeedPatient,
  type Tone,
} from "./monitoring-feed";
import {
  bucketMinutesFor,
  rangeBounds,
  useSeries,
  type SeriesPoint,
} from "./series";
import { repositioningStatus } from "./repositioning";

/**
 * Expanded Monitoring for one patient (/monitoring/:id): what is happening right now and over the
 * last 6 / 12 / 24 hours. Live simulation state + history endpoints only; nothing is invented.
 */

const HOUR = 3600_000;
const MINUTE = 60_000;

type Range = "6H" | "12H" | "24H";
const RANGES: { value: Range; label: string }[] = [
  { value: "6H", label: "6H" },
  { value: "12H", label: "12H" },
  { value: "24H", label: "24H" },
];
/** Hours between x-axis ticks for each range. */
const TICK_HOURS: Record<Range, number> = { "6H": 1, "12H": 3, "24H": 6 };

// ---------------------------------------------------------------- formatting

/** Same status pill mapping as the Monitoring feed card. */
const PILL: Record<Tone, { text: string; tone: KitTone }> = {
  alert: { text: "Review", tone: "red" },
  warning: { text: "Watch", tone: "amber" },
  stable: { text: "Stable", tone: "green" },
  offline: { text: "Offline", tone: "grey" },
};
function pill(f: FeedPatient) {
  const p = PILL[f.tone];
  return f.tone === "offline" && f.statusLabel === "Awaiting data"
    ? { ...p, text: "Awaiting" }
    : p;
}

interface MetricMeta {
  label: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; strokeWidth?: number }>;
  /** CSS class carrying the metric's accent colour. */
  accent: string;
  digits: number;
  /** Smallest y-axis span, so normal sensor noise is not blown up into drama. */
  minSpan: number;
}
const METRICS: Record<string, MetricMeta> = {
  HEART_RATE: {
    label: "Heart rate",
    icon: HeartPulse,
    accent: "a-heart",
    digits: 0,
    minSpan: 20,
  },
  SPO2: {
    label: "SpO₂",
    icon: Droplets,
    accent: "a-spo2",
    digits: 0,
    minSpan: 6,
  },
  RESPIRATORY_RATE: {
    label: "Respiratory rate",
    icon: Wind,
    accent: "a-resp",
    digits: 0,
    minSpan: 8,
  },
  TEMPERATURE: {
    label: "Temperature",
    icon: Thermometer,
    accent: "a-temp",
    digits: 1,
    minSpan: 1,
  },
};
const VITAL_ORDER = ["HEART_RATE", "SPO2", "RESPIRATORY_RATE", "TEMPERATURE"];
const meta = (key: string): MetricMeta =>
  METRICS[key] ?? {
    label: words(key),
    icon: Activity,
    accent: "a-default",
    digits: 1,
    minSpan: 1,
  };

const shortUnit = (unit: string) => (unit === "breaths/min" ? "/min" : unit);
/** Symbols hug the number (97%, 38.2°C); words get a gap (113 bpm). */
const tight = (unit: string) => /^[%°/]/.test(unit);
const fmt = (v: number, digits: number) => {
  const s = v.toFixed(digits);
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
};
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------- chart geometry

const VB_W = 1000;
const VB_H = 200;
const PAD_Y = 14;

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
function niceDomain(
  lo: number,
  hi: number,
  minSpan: number,
  symmetric = false,
) {
  if (symmetric) {
    const m = Math.max(Math.abs(lo), Math.abs(hi), minSpan / 2);
    const step = niceStep(m / 2);
    const top = Math.ceil(m / step) * step;
    return { lo: -top, hi: top, step };
  }
  const pad = Math.max(0, minSpan - (hi - lo)) / 2;
  const a = lo - pad,
    b = hi + pad;
  const step = niceStep((b - a) / 3);
  let l = Math.floor(a / step) * step;
  let h = Math.ceil(b / step) * step;
  if (h === l) {
    l -= step;
    h += step;
  }
  return { lo: l, hi: h, step };
}
function yTicks(lo: number, hi: number, step: number) {
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 1000; v += step)
    out.push(Number(v.toFixed(6)));
  return out;
}

interface Geometry {
  from: number;
  to: number;
  lo: number;
  hi: number;
}
const xOf = (g: Geometry, t: number) => ((t - g.from) / (g.to - g.from)) * VB_W;
const yOf = (g: Geometry, v: number) =>
  PAD_Y + ((g.hi - v) / (g.hi - g.lo)) * (VB_H - 2 * PAD_Y);

/** Splits points into runs of consecutive buckets: a missing bucket ends a run (drawn as a gap). */
function segments(points: SeriesPoint[], bucketMs: number) {
  const out: SeriesPoint[][] = [];
  let run: SeriesPoint[] = [];
  for (const p of points) {
    const prev = run.at(-1);
    if (prev && Date.parse(p.t) - Date.parse(prev.t) > bucketMs * 1.5) {
      out.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) out.push(run);
  return out;
}
/** Clock-aligned ticks every `hours` (e.g. 1 AM, 2 AM … or 12 AM, 6 AM …), clear of the "Now" label. */
function timeTicks(from: number, to: number, hours: number) {
  const out: { t: number; label: string }[] = [];
  const start = new Date(from);
  start.setMinutes(0, 0, 0);
  for (let t = start.getTime() + HOUR; t <= to; t += HOUR) {
    const d = new Date(t);
    if (d.getHours() % hours !== 0) continue;
    const frac = (t - from) / (to - from);
    if (frac < 0.05 || frac > 0.8) continue;
    out.push({ t, label: d.toLocaleTimeString([], { hour: "numeric" }) });
  }
  return out;
}
const px = (g: Geometry, p: SeriesPoint, bucketMs: number) =>
  xOf(g, Date.parse(p.t) + bucketMs / 2).toFixed(1);
function linePath(g: Geometry, run: SeriesPoint[], bucketMs: number) {
  return run
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${px(g, p, bucketMs)} ${yOf(g, p.value).toFixed(1)}`,
    )
    .join("");
}
function areaPath(g: Geometry, run: SeriesPoint[], bucketMs: number) {
  return `${linePath(g, run, bucketMs)}L${px(g, run.at(-1)!, bucketMs)} ${VB_H}L${px(g, run[0]!, bucketMs)} ${VB_H}Z`;
}

// ---------------------------------------------------------------- chart

interface ChartSeries {
  key: string;
  label: string;
  points: SeriesPoint[];
  className: string;
  area?: boolean;
}

/**
 * Handwritten SVG time chart. The SVG stretches to the card (non-scaling strokes); labels are HTML so
 * text never distorts. Tap / hover / arrow keys select a bucket; `onSelect` reports it.
 */
function TimeChart({
  series,
  from,
  to,
  range,
  bucketMs,
  minSpan,
  symmetric,
  markers = [],
  summary,
  selected,
  onSelect,
}: {
  series: ChartSeries[];
  from: number;
  to: number;
  range: Range;
  bucketMs: number;
  minSpan: number;
  symmetric?: boolean;
  markers?: number[];
  summary: string;
  selected: number | null;
  onSelect: (t: number | null) => void;
}) {
  const gradient = useId().replace(/:/g, "");
  const plot = useRef<HTMLDivElement>(null);
  const all = series.flatMap((s) => s.points);
  const d = niceDomain(
    Math.min(...all.map((p) => p.value)),
    Math.max(...all.map((p) => p.value)),
    minSpan,
    symmetric,
  );
  const g: Geometry = { from, to, lo: d.lo, hi: d.hi };
  const ys = yTicks(d.lo, d.hi, d.step);
  const times = [...new Set(all.map((p) => Date.parse(p.t)))].sort(
    (a, b) => a - b,
  );

  const nearest = (clientX: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || !times.length) return null;
    const t =
      from + ((clientX - box.left) / box.width) * (to - from) - bucketMs / 2;
    return times.reduce(
      (best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best),
      times[0]!,
    );
  };
  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointermove" && e.pointerType !== "mouse") return; // touch: tap selects, swipe scrolls
    onSelect(nearest(e.clientX));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!times.length) return;
    const i = selected === null ? times.length : times.indexOf(selected);
    if (e.key === "ArrowLeft") onSelect(times[Math.max(0, i - 1)]!);
    else if (e.key === "ArrowRight")
      onSelect(i >= times.length - 1 ? null : times[i + 1]!);
    else if (e.key === "Escape") onSelect(null);
    else return;
    e.preventDefault();
  };
  const selX =
    selected !== null ? (xOf(g, selected + bucketMs / 2) / VB_W) * 100 : null;

  return (
    <div className="md-chart">
      <div
        ref={plot}
        className="md-plot"
        role="group"
        aria-roledescription="graph"
        aria-label={summary}
        tabIndex={0}
        onPointerDown={onPointer}
        onPointerMove={onPointer}
        onPointerLeave={(e) => e.pointerType === "mouse" && onSelect(null)}
        onKeyDown={onKey}
      >
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          aria-hidden
          focusable="false"
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ys.map((v) => (
            <line
              key={v}
              className={symmetric && v === 0 ? "md-grid zero" : "md-grid"}
              x1={0}
              x2={VB_W}
              y1={yOf(g, v)}
              y2={yOf(g, v)}
            />
          ))}
          {markers.map((t) => (
            <line
              key={t}
              className="md-marker"
              x1={xOf(g, t)}
              x2={xOf(g, t)}
              y1={0}
              y2={VB_H}
            />
          ))}
          {series.map((s) =>
            segments(s.points, bucketMs).map((run, i) => (
              <g key={`${s.key}-${i}`} className={s.className}>
                {s.area && run.length > 3 && (
                  <path
                    className="md-area"
                    d={areaPath(g, run, bucketMs)}
                    fill={`url(#${gradient})`}
                  />
                )}
                <path
                  className={run.length === 1 ? "md-dot" : "md-line"}
                  d={
                    run.length === 1
                      ? `${linePath(g, run, bucketMs)}h0.01`
                      : linePath(g, run, bucketMs)
                  }
                />
              </g>
            )),
          )}
        </svg>
        <div className="md-yaxis" aria-hidden>
          {ys.map((v, i) =>
            ys.length <= 4 || i % 2 === 0 || i === ys.length - 1 ? (
              <span key={v} style={{ top: `${(yOf(g, v) / VB_H) * 100}%` }}>
                {fmt(v, d.step < 1 ? 1 : 0)}
              </span>
            ) : null,
          )}
        </div>
        {selX !== null && (
          <span className="md-cursor" style={{ left: `${selX}%` }} aria-hidden>
            {series.map((s) => {
              const p = s.points.find((x) => Date.parse(x.t) === selected);
              return p ? (
                <i
                  key={s.key}
                  className={s.className}
                  style={{ top: `${(yOf(g, p.value) / VB_H) * 100}%` }}
                />
              ) : null;
            })}
          </span>
        )}
      </div>
      <div className="md-xaxis" aria-hidden>
        {timeTicks(from, to, TICK_HOURS[range]).map((t) => (
          <span
            key={t.t}
            style={{ left: `${((t.t - from) / (to - from)) * 100}%` }}
          >
            {t.label}
          </span>
        ))}
        <span className="now">Now</span>
      </div>
    </div>
  );
}

function rangeOf(points: SeriesPoint[], digits: number) {
  if (!points.length) return null;
  const lo = Math.min(...points.map((p) => p.value)),
    hi = Math.max(...points.map((p) => p.value));
  return fmt(lo, digits) === fmt(hi, digits)
    ? null
    : `${fmt(lo, digits)}–${fmt(hi, digits)}`;
}

function LiveDot() {
  return (
    <span className="md-live">
      <span className="md-live-dot" aria-hidden />
      Live simulation
    </span>
  );
}

/** Live only when the feed says LIVE and the reading is under 2 minutes old on the demo clock. */
const isLive = (m: FeedMeasurement | undefined, now: number) =>
  !!m &&
  m.state === "LIVE" &&
  m.value !== null &&
  !!m.at &&
  now - Date.parse(m.at) < 2 * MINUTE;

// ---------------------------------------------------------------- vital card

function VitalCard({
  patientId,
  metric,
  current,
  from,
  to,
  range,
  revision,
  now,
}: {
  patientId: string;
  metric: string;
  current?: FeedMeasurement;
  from: string;
  to: string;
  range: Range;
  revision: unknown;
  now: number;
}) {
  const m = meta(metric);
  const Icon = m.icon;
  const { series, error, loading } = useSeries(
    patientId,
    metric,
    from,
    to,
    revision,
  );
  const [selected, setSelected] = useState<number | null>(null);
  // Clip to the window so a range change re-scales instantly while the new history loads.
  const points = useMemo(() => {
    const f = Date.parse(from),
      t = Date.parse(to);
    return (series?.points ?? []).filter(
      (p) => Date.parse(p.t) >= f && Date.parse(p.t) <= t,
    );
  }, [series, from, to]);
  const bucketMs =
    (series?.bucketMinutes ?? bucketMinutesFor(from, to)) * MINUTE;
  const unit = shortUnit(current?.unit || series?.unit || "");
  const span = rangeOf(points, m.digits);
  const sel =
    selected !== null
      ? points.find((p) => Date.parse(p.t) === selected)
      : undefined;
  const value = sel ? sel.value : (current?.value ?? null);
  const hours = range.replace("H", "");
  const summary = points.length
    ? `${m.label}, last ${hours} hours${span ? `, ${span} ${unit}` : ""}${current?.value != null ? `, current ${fmt(current.value, m.digits)} ${unit}` : ""}. Arrow keys inspect values.`
    : `${m.label}: no readings in the last ${hours} hours.`;

  return (
    <article className={`md-metric ${m.accent}`} aria-label={m.label}>
      <header className="md-metric-head">
        <span className="md-metric-name">
          <Icon aria-hidden strokeWidth={2} />
          {m.label}
        </span>
        {sel ? (
          <time className="md-metric-aside" dateTime={sel.t}>
            {clock(Date.parse(sel.t))}
          </time>
        ) : (
          span && (
            <span className="md-metric-aside">
              {span}
              {unit && (
                <span className={tight(unit) ? "tight" : undefined}>
                  {unit}
                </span>
              )}
            </span>
          )
        )}
      </header>
      <div className="md-metric-value">
        <strong className={value === null ? "is-empty" : undefined}>
          {value === null ? "—" : fmt(value, m.digits)}
          {value !== null && unit && (
            <small className={tight(unit) ? "tight" : undefined}>{unit}</small>
          )}
        </strong>
        {!sel && isLive(current, now) && <LiveDot />}
      </div>
      {loading && !series ? (
        <div className="md-chart-skeleton" role="status" aria-label="Loading" />
      ) : error && !series ? (
        <p className="md-chart-empty">History unavailable</p>
      ) : points.length < 2 ? null : (
        <TimeChart
          series={[
            {
              key: metric,
              label: m.label,
              points,
              className: "s-accent",
              area: true,
            },
          ]}
          from={Date.parse(from)}
          to={Date.parse(to)}
          range={range}
          bucketMs={bucketMs}
          minSpan={m.minSpan}
          summary={summary}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      <span className="md-sr" aria-live="polite">
        {sel
          ? `${m.label} ${fmt(sel.value, m.digits)} ${unit} at ${clock(Date.parse(sel.t))}`
          : ""}
      </span>
    </article>
  );
}

// ---------------------------------------------------------------- orientation history

const REGIONS = ["UPPER_TORSO", "PELVIS"] as const;
type Region = (typeof REGIONS)[number];

function bucketSamples(
  samples: OrientationSample[],
  region: Region,
  from: number,
  to: number,
  bucketMinutes: number,
) {
  const size = bucketMinutes * MINUTE;
  const buckets = new Map<number, number[]>();
  for (const s of samples) {
    if (s.bodyRegion !== region) continue;
    const t = Date.parse(s.capturedAt);
    if (
      !Number.isFinite(t) ||
      t < from ||
      t > to ||
      !Number.isFinite(s.rollDegrees)
    )
      continue;
    if (!["VALID", "SIMULATED_GOOD"].includes(s.quality)) continue;
    const key = from + Math.floor((t - from) / size) * size;
    const list = buckets.get(key) ?? [];
    list.push(s.rollDegrees);
    buckets.set(key, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, v]) => ({
      t: new Date(key).toISOString(),
      value: v.reduce((a, b) => a + b, 0) / v.length,
      min: Math.min(...v),
      max: Math.max(...v),
      count: v.length,
    }));
}

/** Torso / pelvis roll: the orientation series endpoint, falling back to live state samples. */
function useOrientationHistory(
  patientId: string | undefined,
  state: State,
  from: string,
  to: string,
  revision: unknown,
) {
  const [server, setServer] = useState<{
    key: string;
    points: Record<Region, SeriesPoint[]>;
  } | null>(null);
  const bucketMinutes = bucketMinutesFor(from, to);
  const fromKey = from.slice(0, 16),
    toKey = to.slice(0, 16);
  const requestKey = `${patientId}|${bucketMinutes}`;
  useEffect(() => {
    if (!patientId) return;
    let active = true;
    const q = (r: Region) =>
      `/patients/${encodeURIComponent(patientId)}/orientation/series?region=${r}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucketMinutes=${bucketMinutes}`;
    Promise.all(REGIONS.map((r) => api<{ points: SeriesPoint[] }>(q(r))))
      .then(
        ([torso, pelvis]) =>
          active &&
          setServer({
            key: requestKey,
            points: { UPPER_TORSO: torso!.points, PELVIS: pelvis!.points },
          }),
      )
      .catch(() => active && setServer(null));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, fromKey, toKey, bucketMinutes, revision]);

  return useMemo(() => {
    if (server && server.key === requestKey)
      return { points: server.points, bucketMinutes };
    const own = (state.samples ?? []).filter((s) => s.patientId === patientId);
    const f = Date.parse(from),
      t = Date.parse(to);
    return {
      points: {
        UPPER_TORSO: bucketSamples(own, "UPPER_TORSO", f, t, bucketMinutes),
        PELVIS: bucketSamples(own, "PELVIS", f, t, bucketMinutes),
      },
      bucketMinutes,
    };
  }, [server, requestKey, state.samples, patientId, from, to, bucketMinutes]);
}

// ---------------------------------------------------------------- position card

function PositionCard({
  f,
  state,
  patient,
  from,
  to,
  range,
  now,
  revision,
}: {
  f: FeedPatient;
  state: State;
  patient: Patient;
  from: string;
  to: string;
  range: Range;
  now: number;
  revision: unknown;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const orientation = useOrientationHistory(
    patient.id,
    state,
    from,
    to,
    revision,
  );
  const fromMs = Date.parse(from),
    toMs = Date.parse(to);
  const bucketMs = orientation.bucketMinutes * MINUTE;
  const series: ChartSeries[] = [
    {
      key: "UPPER_TORSO",
      label: "Torso",
      points: orientation.points.UPPER_TORSO,
      className: "s-torso",
    },
    {
      key: "PELVIS",
      label: "Pelvis",
      points: orientation.points.PELVIS,
      className: "s-pelvis",
    },
  ];
  const drawn = series.filter((s) => s.points.length);
  const chartable = drawn.some((s) => s.points.length >= 2);
  const turns = state.movements
    .filter((m) => m.patientId === patient.id)
    .map((m) => Date.parse(m.capturedAt))
    .filter((t) => Number.isFinite(t) && t >= fromMs && t <= toMs);
  const status = repositioningStatus(state, patient, now);
  const hours = range.replace("H", "");

  if (!f.posture.length && !patient.repositionPlan) return null;

  const figure = (key: string) => {
    const m = f.posture.find((p) => p.key === `ROLL_${key}`);
    const s = series.find((x) => x.key === key)!;
    const point =
      selected !== null
        ? s.points.find((p) => Date.parse(p.t) === selected)
        : undefined;
    const value = point ? point.value : (m?.value ?? null);
    if (!m && !point) return null;
    return (
      <div key={key} className={`md-roll ${s.className}`}>
        <span className="md-roll-name">
          <i className="md-swatch" aria-hidden />
          {s.label}
        </span>
        <strong className={value === null ? "is-empty" : undefined}>
          {value === null ? "—" : fmt(value, 0)}
          {value !== null && "°"}
        </strong>
      </div>
    );
  };

  const summary = `Body roll in degrees, last ${hours} hours. ${drawn
    .map(
      (s) => `${s.label} ${rangeOf(s.points, 0) ?? fmt(s.points[0]!.value, 0)}`,
    )
    .join(
      "; ",
    )}. ${turns.length ? `${turns.length} detected turn${turns.length === 1 ? "" : "s"} marked.` : ""} Arrow keys inspect values.`;

  return (
    <article
      className="md-metric md-position"
      aria-label="Position and turning"
    >
      <header className="md-metric-head">
        <span className="md-metric-name">
          <Move aria-hidden strokeWidth={2} />
          Position
        </span>
        {selected !== null && (
          <time
            className="md-metric-aside"
            dateTime={new Date(selected).toISOString()}
          >
            {clock(selected)}
          </time>
        )}
      </header>
      <div className="md-rolls">
        {figure("UPPER_TORSO")}
        {figure("PELVIS")}
        {selected === null && f.posture.some((p) => isLive(p, now)) && (
          <LiveDot />
        )}
      </div>
      {chartable && (
        <TimeChart
          series={drawn}
          from={fromMs}
          to={toMs}
          range={range}
          bucketMs={bucketMs}
          minSpan={60}
          symmetric
          markers={turns}
          summary={summary}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      {patient.repositionPlan && Number.isFinite(status.due) && (
        <p
          className={`md-turn${status.schedule === "OVERDUE" ? " overdue" : ""}`}
        >
          {status.schedule === "OVERDUE"
            ? "Turn overdue"
            : `Next turn due ${clock(status.due)}`}
        </p>
      )}
    </article>
  );
}

// ---------------------------------------------------------------- notable events

interface MonitoringEvent {
  id: string;
  at: number;
  title: string;
  kind: "device" | "turn" | "nurse";
}

function deviceLabel(
  state: State,
  patientId: string,
  details: string,
  source: string,
) {
  const d = (state.devices ?? []).find(
    (x) => x.patientId === patientId && details.includes(x.id),
  );
  const region =
    d?.bodyRegion ?? (source === "SIMULATED_MONITOR" ? "BEDSIDE_MONITOR" : "");
  return (
    (
      {
        BEDSIDE_MONITOR: "Monitor",
        UPPER_TORSO: "Torso sensor",
        PELVIS: "Pelvis sensor",
      } as Record<string, string>
    )[region] ?? "Device"
  );
}

/**
 * Notable, non-routine events in the window: device connection changes, detected turns and nurse
 * confirmations. Routine vital batches, tasks and chart notes are left out.
 */
function buildEvents(
  state: State,
  patient: Patient,
  fetched: Event[],
  from: number,
  to: number,
): MonitoringEvent[] {
  const byId = new Map<string, Event>();
  for (const e of [...fetched, ...state.events])
    if (e.patientId === patient.id) byId.set(e.id, e);
  const out: MonitoringEvent[] = [];
  for (const e of byId.values()) {
    const at = Date.parse(e.timestamp);
    if (!Number.isFinite(at) || at < from || at > to) continue;
    if (e.type.startsWith("device.")) {
      const what = e.type.slice("device.".length);
      const text =
        what === "freshness"
          ? /FRESH/.test(e.details)
            ? "back online"
            : /STALE/.test(e.details)
              ? "not updating"
              : "signal unknown"
          : what === "connected"
            ? "connected"
            : what === "disconnected"
              ? "disconnected"
              : what === "delayed"
                ? "delayed"
                : words(what);
      out.push({
        id: e.id,
        at,
        title: `${deviceLabel(state, patient.id, e.details, e.source)} ${text}`,
        kind: "device",
      });
    } else if (e.type === "repositioning.confirmed") {
      out.push({
        id: e.id,
        at,
        title: "Turn confirmed by nurse",
        kind: "nurse",
      });
    }
  }
  for (const m of state.movements) {
    const at = Date.parse(m.capturedAt);
    if (
      m.patientId !== patient.id ||
      !Number.isFinite(at) ||
      at < from ||
      at > to
    )
      continue;
    out.push({ id: `mv-${m.id}`, at, title: "Turn detected", kind: "turn" });
  }
  return out.sort((a, b) => b.at - a.at);
}

function useRecentEvents(patientId: string | undefined, revision: unknown) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    if (!patientId) return;
    let active = true;
    api<Event[]>(`/events?patientId=${encodeURIComponent(patientId)}&limit=300`)
      .then((list) => active && Array.isArray(list) && setEvents(list))
      .catch(() => undefined); // live state.events still covers the recent window
    return () => {
      active = false;
    };
  }, [patientId, revision]);
  return events;
}

const EVENT_ICON = {
  device: RadioTower,
  turn: Move,
  nurse: ClipboardCheck,
} as const;

function EventList({ events }: { events: MonitoringEvent[] }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ol className="md-events">
        {(all ? events : events.slice(0, 3)).map((e) => {
          const Icon = EVENT_ICON[e.kind];
          return (
            <li key={e.id} className={`md-event kind-${e.kind}`}>
              <span className="md-event-icon" aria-hidden>
                <Icon strokeWidth={2} />
              </span>
              <span className="md-event-title">{e.title}</span>
              <time dateTime={new Date(e.at).toISOString()}>{clock(e.at)}</time>
            </li>
          );
        })}
      </ol>
      {events.length > 3 && (
        <button
          type="button"
          className="md-more"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show less" : "See all"}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------- page

export function MonitoringDetail({ state }: ScreenProps) {
  const { id } = useParams();
  const location = useLocation();
  const patient = state.patients.find((p) => p.id === id);
  const now = useDemoNow(state);
  const [range, setRange] = useState<Range>("6H");
  const { from, to } = rangeBounds(range, now);
  const revision = state.serverTime?.slice(0, 16) ?? null;
  const fetchedEvents = useRecentEvents(patient?.id, revision);

  if (!patient)
    return (
      <Screen className="md">
        <ScreenHeader
          back="/"
          backLabel="Back to Monitoring"
          title="Monitoring"
        />
        <EmptyState title="Patient not available" />
      </Screen>
    );

  const f = feedPatient(state, patient, now);
  const p = pill(f);
  const vitalKeys = [
    ...VITAL_ORDER.filter((k) => f.vitals.some((v) => v.key === k)),
    ...f.vitals.map((v) => v.key).filter((k) => !VITAL_ORDER.includes(k)),
  ];
  const events = buildEvents(
    state,
    patient,
    fetchedEvents,
    Date.parse(from),
    Date.parse(to),
  );

  return (
    <Screen className="md">
      <ScreenHeader
        back="/"
        backLabel="Back to Monitoring"
        title={`Room ${patient.room}`}
        subtitle={patient.name}
        right={
          <span className="md-head-pill">
            <Pill tone={p.tone}>{p.text}</Pill>
          </span>
        }
      />

      <div className="md-quick-actions" aria-label="Patient actions">
        <Link
          to={`/patients/${patient.id}`}
          state={{ from: location.pathname }}
          className="ach-button secondary"
        >
          Patient record
        </Link>
        <Link
          to={`/patients/${patient.id}?section=chart&compose=1`}
          state={{ from: location.pathname }}
          className="ach-button"
        >
          <PenLine size={17} aria-hidden /> Document care
        </Link>
      </div>

      <div className="md-range">
        <Segmented
          options={RANGES}
          value={range}
          onChange={setRange}
          label="Time range"
        />
      </div>

      <div className="md-stack">
        {vitalKeys.length ? (
          vitalKeys.map((k) => (
            <VitalCard
              key={k}
              patientId={patient.id}
              metric={k}
              current={f.vitals.find((v) => v.key === k)}
              from={from}
              to={to}
              range={range}
              revision={revision}
              now={now}
            />
          ))
        ) : (
          <EmptyState title="No vital signs yet" />
        )}
        <PositionCard
          f={f}
          state={state}
          patient={patient}
          from={from}
          to={to}
          range={range}
          now={now}
          revision={revision}
        />
      </div>

      {events.length > 0 && (
        <Section title="Recent">
          <EventList events={events} />
        </Section>
      )}

      <Link to={`/patients/${patient.id}`} className="md-record">
        Open full patient record
        <ChevronRight aria-hidden strokeWidth={2} />
      </Link>
    </Screen>
  );
}

/** Pure helpers, exported for unit tests. */
export const __test = { buildEvents, segments, niceDomain, timeTicks };
