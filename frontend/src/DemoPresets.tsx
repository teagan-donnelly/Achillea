import { useEffect, useState } from "react";
import type { DemoPlan, Patient } from "./types";
import { api } from "./api";

const names: Record<string, string> = {
  "routine-shift": "Routine shift",
  "device-event": "Device event",
  repositioning: "Patient repositioning",
  "bedside-documentation": "Bedside documentation",
  "adaptive-rounds": "Adaptive rounds",
};
export function DemoPresets({
  patients,
  busy,
  refresh,
  onNavigate,
}: {
  patients: Patient[];
  busy: boolean;
  refresh: () => Promise<void>;
  onNavigate: (patientId: string, section: string) => void;
}) {
  const [keys, setKeys] = useState<string[]>([]),
    [plan, setPlan] = useState<DemoPlan | null>(null),
    [stepIndex, setStepIndex] = useState(0),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [verified, setVerified] = useState(false),
    [text, setText] = useState(""),
    [feedback, setFeedback] = useState("");
  const [inspection, setInspection] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    api<{ keys: string[] }>("/demo/presets")
      .then((data) => {
        if (active) {
          setKeys(data.keys);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Cannot load presets");
      });
    return () => {
      active = false;
    };
  }, []);
  async function start(key: string) {
    const patient =
      key === "repositioning"
        ? patients.find((p) => p.repositionPlan)
        : patients[0];
    if (!patient) return;
    setPending(true);
    setError("");
    setFeedback("");
    setInspection([]);
    try {
      const result = await api<DemoPlan>(
        `/demo/presets/${key}?patientId=${encodeURIComponent(patient.id)}`,
        {},
      );
      setPlan(result);
      setStepIndex(0);
      setBindings({});
      setVerified(false);
      setText("");
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Preset failed; inspect history before retrying",
      );
    } finally {
      setPending(false);
    }
  }
  const step = plan?.steps[stepIndex];
  const requiresVerification = Boolean(step?.body.verified);
  const textField =
    step &&
    ("text" in step.body ? "text" : "reason" in step.body ? "reason" : null);
  async function runStep() {
    if (!step) return;
    let path = step.path;
    Object.entries(bindings).forEach(([key, value]) => {
      path = path.replaceAll(`\${${key}}`, value);
    });
    if (path.includes("${")) {
      setError("An earlier step must be completed first.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const body = {
        ...step.body,
        ...(requiresVerification ? { verified } : {}),
        ...(textField ? { [textField]: text } : {}),
      };
      const result = await api<{ id?: string }>(
        path.replace(/^\/api/, ""),
        step.method === "GET" ? undefined : body,
        step.method,
      );
      if (step.method === "GET") setInspection(describeEvidence(result));
      if (step.captureAs && result.id)
        setBindings((previous) => ({
          ...previous,
          [step.captureAs!]: result.id!,
        }));
      await refresh();
      setStepIndex((index) => index + 1);
      setVerified(false);
      setText("");
      setFeedback("Step completed against the synthetic backend.");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Step failed; your input is retained",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="demo-presets" aria-label="Educational demo presets">
      <h3>Guided demonstrations</h3>
      <p>
        Educational simulation tools. Presets add synthetic evidence; they never
        reset records or automatically confirm nursing care.
      </p>
      <div className="scenario-buttons">
        {keys.map((key) => (
          <button
            type="button"
            className="secondary"
            key={key}
            disabled={
              busy ||
              pending ||
              !patients.length ||
              (key === "repositioning" &&
                !patients.some((p) => p.repositionPlan))
            }
            onClick={() => void start(key)}
          >
            {names[key] ?? key}
          </button>
        ))}
      </div>
      {!patients.some((p) => p.repositionPlan) && (
        <small>
          Switch the demo unit to ICU to start Patient repositioning.
        </small>
      )}
      {error && <p role="alert">{error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {inspection.length > 0 && (
        <section aria-label="Last inspected demo evidence">
          <h4>Inspected evidence</h4>
          <ul>
            {inspection.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {plan && (
        <div className="preset-guide">
          <h4>{names[plan.key]}</h4>
          <p>
            Prepared for{" "}
            {patients.find((p) => p.id === plan.patientId)?.name ??
              "assigned patient"}
            . Each action below requires your explicit selection.
          </p>
          <ol>
            {plan.steps.map((item, index) => (
              <li
                key={index}
                aria-current={index === stepIndex ? "step" : undefined}
              >
                {item.title}
                {index < stepIndex ? " — completed" : ""}
              </li>
            ))}
          </ol>
          {step ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void runStep();
              }}
            >
              <strong>{step.title}</strong>
              {textField && (
                <label>
                  {textField === "reason"
                    ? "Deferral reason"
                    : "Synthetic bedside note"}
                  <textarea
                    required
                    maxLength={textField === "reason" ? 1000 : 5000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
              )}
              {requiresVerification && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={verified}
                    onChange={(e) => setVerified(e.target.checked)}
                  />
                  I explicitly verify this synthetic nursing action.
                </label>
              )}
              <button
                disabled={
                  busy ||
                  pending ||
                  (requiresVerification && !verified) ||
                  (!!textField && !text.trim())
                }
              >
                Run this step
              </button>
            </form>
          ) : (
            <p role="status">
              Demonstration complete. Documentation and activity remain in the
              record.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onNavigate(
                plan.patientId,
                plan.key === "repositioning"
                  ? "sensors"
                  : plan.key === "bedside-documentation"
                    ? "chart"
                    : plan.key === "adaptive-rounds"
                      ? "tasks"
                      : "vitals",
              )
            }
          >
            Open bedside workspace
          </button>
        </div>
      )}
    </section>
  );
}

function describeEvidence(value: unknown): string[] {
  if (Array.isArray(value))
    return value.map((item) => {
      if (item.name) return `${item.name} / Room ${item.room}`;
      if (item.task)
        return `${item.task.title} / ${item.horizon} / ${item.reason}`;
      if (item.connectionState)
        return `${item.bodyRegion}: ${item.connectionState} / ${item.freshness}`;
      return String(item.summary ?? item.details ?? "Recorded evidence");
    });
  if (value && typeof value === "object") {
    const record = value as {
      measurements?: unknown[];
      samples?: unknown[];
      devices?: {
        bodyRegion: string;
        connectionState: string;
        freshness: string;
      }[];
      movements?: {
        movement: { classification: string; verificationStatus: string };
      }[];
    };
    return [
      ...(record.measurements
        ? [
            `${record.measurements.length} recorded measurements in this response`,
          ]
        : []),
      ...(record.samples
        ? [`${record.samples.length} recorded orientation samples`]
        : []),
      ...(record.devices ?? []).map(
        (d) => `${d.bodyRegion}: ${d.connectionState} / ${d.freshness}`,
      ),
      ...(record.movements ?? []).map(
        (m) =>
          `${m.movement.classification} / ${m.movement.verificationStatus}`,
      ),
    ];
  }
  return [];
}
