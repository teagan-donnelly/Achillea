// Recorded-data replay controller and monitoring alerts (backend: ReplayEngine, MonitoringController).
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pause, Play, RotateCcw, Repeat, Check, FileText, AlertTriangle } from "lucide-react";
import { api, time } from "./api";
import { Pill, type Tone } from "./ui";
import "./replay.css";

export interface ReplayStatus {
  enabled: boolean;
  label: string;
  sessionId: string | null;
  state: "DISABLED" | "STARTING" | "PLAYING" | "PAUSED" | "ENDED";
  speed: number;
  speeds: number[];
  loop: boolean;
  loopIndex: number;
  recordedMinute: number;
  firstMinute: number;
  lastMinute: number;
  readingsWritten: number;
  patients: { patientId: string; kind: string; stay: string | null; source: string; lastRecordedMinute: number | null }[];
}

export interface EvidenceReading {
  id: string;
  metric: string;
  value: number;
  unit: string;
  observedAt: string;
  recordedMinute: number | null;
  source: string;
}

export type AlertState = "FLAGGED" | "ACKNOWLEDGED" | "FOLLOW_UP_DOCUMENTED" | "RESOLVED";

export interface MonitoringAlert {
  id: string;
  patientId: string;
  patientName: string | null;
  room: string | null;
  rule: string | null;
  title: string;
  details: string;
  detectedAt: string;
  source: string;
  evidence: EvidenceReading[];
  state: AlertState;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  followUpChartIds: string[];
  documentationGap: boolean;
  carriedForward: boolean;
  resolvedAt: string | null;
}

export const ALERT_STATE: Record<AlertState, { label: string; tone: Tone }> = {
  FLAGGED: { label: "Flagged for review", tone: "red" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "amber" },
  FOLLOW_UP_DOCUMENTED: { label: "Follow-up documented", tone: "green" },
  RESOLVED: { label: "Resolved", tone: "grey" },
};

/** Recorded shift minute as "Shift +3h 20m" (relative to the recording's shift start). */
export function recordedTime(minute: number | null | undefined) {
  if (minute === null || minute === undefined) return "";
  const sign = minute < 0 ? "−" : "+";
  const m = Math.abs(minute);
  return `shift ${sign}${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Re-fetches whenever `tick` changes (the app's live state) and every 5 s as a fallback. */
function usePolled<T>(path: string | null, tick: unknown) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unavailable");
    }
  }, [path]);
  useEffect(() => {
    void load();
  }, [load, tick]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  return { data, error, reload: load, setData };
}

export function useReplayStatus(tick: unknown) {
  return usePolled<ReplayStatus>("/replay/status", tick);
}

export function useAlerts(patientId: string | undefined, tick: unknown) {
  return usePolled<MonitoringAlert[]>(
    `/monitoring/alerts${patientId ? `?patientId=${encodeURIComponent(patientId)}` : ""}`,
    tick,
  );
}

export function ReplayBar({ tick }: { tick: unknown }) {
  const { data, error, setData } = useReplayStatus(tick);
  const [busy, setBusy] = useState(false);
  if (error || !data || typeof data.enabled !== "boolean") return null;
  if (!data.enabled)
    return (
      <div className="rp-bar is-off" role="status">
        <Pill tone="grey">Simulated monitor</Pill>
      </div>
    );
  const send = async (action: string, body: unknown = {}) => {
    setBusy(true);
    try {
      setData(await api<ReplayStatus>(`/replay/${action}`, body));
    } finally {
      setBusy(false);
    }
  };
  const playing = data.state === "PLAYING";
  const progress = Math.max(
    0,
    Math.min(100, ((data.recordedMinute - data.firstMinute) / Math.max(1, data.lastMinute - data.firstMinute)) * 100),
  );
  return (
    <section className="rp-bar" aria-label="Recorded data replay (demo only)">
      <div className="rp-row">
        <span className={`rp-dot is-${data.state.toLowerCase()}`} aria-hidden />
        <strong className="rp-title">Recorded Data Replay</strong>
        <span className="rp-meta">
          {data.state === "ENDED" ? "Recording ended" : data.state === "PAUSED" ? "Paused" : "Playing"} ·{" "}
          {recordedTime(data.recordedMinute)} · loop {data.loopIndex + 1}
        </span>
      </div>
      <div className="rp-progress" aria-hidden>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="rp-row rp-controls">
        <button
          type="button"
          className="rp-btn"
          disabled={busy}
          aria-label={playing ? "Pause replay" : "Resume replay"}
          onClick={() => void send(playing ? "pause" : "resume")}
        >
          {playing ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}
        </button>
        <div className="rp-speeds" role="group" aria-label="Replay speed">
          {(Array.isArray(data.speeds) ? data.speeds : [1, 5, 10]).map((s) => (
            <button
              key={s}
              type="button"
              className={`rp-btn${s === data.speed ? " is-on" : ""}`}
              aria-pressed={s === data.speed}
              disabled={busy}
              onClick={() => void send("speed", { speed: s })}
            >
              {s}×
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`rp-btn${data.loop ? " is-on" : ""}`}
          aria-pressed={data.loop}
          aria-label="Loop recording"
          disabled={busy}
          onClick={() => void send("loop", { loop: !data.loop })}
        >
          <Repeat aria-hidden size={16} />
        </button>
        <button
          type="button"
          className="rp-btn"
          aria-label="Restart replay"
          disabled={busy}
          onClick={() => void send("restart")}
        >
          <RotateCcw aria-hidden size={16} />
        </button>
      </div>
    </section>
  );
}

export function AlertCard({
  alert,
  onChanged,
  showPatient = false,
}: {
  alert: MonitoringAlert;
  onChanged: () => void | Promise<void>;
  showPatient?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const state = ALERT_STATE[alert.state];
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  const active = alert.state !== "RESOLVED";
  return (
    <article className={`rp-alert is-${alert.state.toLowerCase()}`} aria-label={alert.title}>
      <header>
        <AlertTriangle aria-hidden size={18} />
        <div>
          <h3>{alert.title}</h3>
          <p className="rp-meta">
            {showPatient && alert.room ? (
              <>
                <Link to={`/monitoring/${alert.patientId}`}>
                  Room {alert.room} · {alert.patientName}
                </Link>{" "}
                ·{" "}
              </>
            ) : null}
            Detected {time(alert.detectedAt)}
          </p>
        </div>
        <Pill tone={state.tone}>{state.label}</Pill>
      </header>
      <p className="rp-details">{alert.details}</p>
      {alert.evidence.length > 0 && (
        <details className="rp-evidence">
          <summary>Supporting readings ({alert.evidence.length})</summary>
          <ul>
            {alert.evidence.map((r) => (
              <li key={r.id}>
                <strong>
                  {r.value} {r.unit}
                </strong>{" "}
                · recorded {recordedTime(r.recordedMinute)} · replayed {time(r.observedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {alert.documentationGap && (
        <p className="rp-gap" role="status">Documentation gap: no follow-up note</p>
      )}
      {alert.carriedForward && <p className="rp-meta">Carried forward</p>}
      {active && (
        <div className="rp-actions">
          {!alert.acknowledged && (
            <button
              type="button"
              className="rp-action"
              disabled={busy}
              onClick={() => void run(() => api(`/monitoring/alerts/${encodeURIComponent(alert.id)}/acknowledge`, {}))}
            >
              <Check aria-hidden size={16} /> Acknowledge
            </button>
          )}
          {alert.state !== "FOLLOW_UP_DOCUMENTED" && (
            <button type="button" className="rp-action" disabled={busy} onClick={() => setWriting(!writing)}>
              <FileText aria-hidden size={16} /> Document follow-up
            </button>
          )}
          {alert.state === "FOLLOW_UP_DOCUMENTED" && (
            <button
              type="button"
              className="rp-action"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/tasks/${encodeURIComponent(alert.id)}/complete`, {
                    verified: true,
                    text: `Monitoring alert resolved after follow-up: ${alert.title}`,
                  }),
                )
              }
            >
              <Check aria-hidden size={16} /> Mark resolved
            </button>
          )}
        </div>
      )}
      {writing && active && (
        <form
          className="rp-note-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void run(async () => {
              const draft = await api<{ id: string }>("/chart/drafts", {
                patientId: alert.patientId,
                type: "CARE_NOTE",
                text: note.trim(),
                linkedTaskId: alert.id,
                linkedVitalIds: alert.evidence.map((r) => r.id),
              });
              await api(`/chart/drafts/${encodeURIComponent(draft.id)}/confirm`, { verified: true });
              setWriting(false);
              setNote("");
            });
          }}
        >
          <label>
            Follow-up note
            <textarea
              rows={3}
              maxLength={5000}
              value={note}
              
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="submit" className="rp-action is-primary" disabled={busy || !note.trim()}>
            Save
          </button>
        </form>
      )}
      {error && (
        <p className="rp-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export function AlertList({
  patientId,
  tick,
  showPatient = false,
  includeResolved = false,
}: {
  patientId?: string;
  tick: unknown;
  showPatient?: boolean;
  includeResolved?: boolean;
}) {
  const { data, reload } = useAlerts(patientId, tick);
  const shown = (Array.isArray(data) ? data : []).filter((a) => includeResolved || a.state !== "RESOLVED");
  if (!shown.length) return null;
  return (
    <section className="rp-alerts" aria-label="Monitoring alerts">
      <h2 className="rp-heading">
        Monitoring alerts <span>{shown.length}</span>
      </h2>
      {shown.map((a) => (
        <AlertCard key={a.id} alert={a} onChanged={reload} showPatient={showPatient} />
      ))}
    </section>
  );
}
