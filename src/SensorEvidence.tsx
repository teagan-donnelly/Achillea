import { useEffect, useState } from "react";
import { api, time, words } from "./api";
import type { SensorHistory } from "./types";

export function SensorEvidence({
  patientId,
  revision,
}: {
  patientId: string;
  revision?: string | null;
}) {
  const [history, setHistory] = useState<SensorHistory | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<SensorHistory>(
      `/patients/${encodeURIComponent(patientId)}/sensor-history`,
    )
      .then((result) => {
        if (active) {
          setHistory(result);
          setError("");
        }
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : "Sensor history unavailable",
          );
      });
    return () => {
      active = false;
    };
  }, [patientId, revision]);
  return (
    <section className="sensor-evidence" aria-label="Recorded sensor history">
      <h3>Recorded sensor history</h3>
      {error && (
        <p role="alert">
          Sensor history could not refresh: {error}. Existing observations may
          be older.
        </p>
      )}
      {!history && !error && <p role="status">Loading region evidence…</p>}
      {history && (
        <>
          <p>
            Independent upper-torso and pelvic observations in{" "}
            {history.orientationUnit}. Capture and receipt times remain
            distinct.
          </p>
          <details>
            <summary>
              Orientation history ({history.samples.length} samples)
            </summary>
            <div className="evidence-scroll">
              <table>
                <caption>Recorded region observations</caption>
                <thead>
                  <tr>
                    <th>Region</th>
                    <th>Roll</th>
                    <th>Captured</th>
                    <th>Received</th>
                    <th>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {history.samples
                    .slice()
                    .sort(
                      (a, b) =>
                        Date.parse(b.capturedAt) - Date.parse(a.capturedAt),
                    )
                    .map((sample) => (
                      <tr key={sample.id}>
                        <td>{words(sample.bodyRegion)}</td>
                        <td>{sample.rollDegrees}°</td>
                        <td>{time(sample.capturedAt)}</td>
                        <td>{time(sample.receivedAt)}</td>
                        <td>{words(sample.quality)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!history.samples.length && (
              <p>
                No region samples available. Missing data is not a zero-degree
                observation.
              </p>
            )}
          </details>
          <details>
            <summary>
              Connectivity and freshness history (
              {history.connectivityEvents.length})
            </summary>
            {history.connectivityEvents.map((event) => (
              <p key={event.id}>
                {time(event.timestamp)} / {event.details}
              </p>
            ))}
            {!history.connectivityEvents.length && (
              <p>No recorded connectivity transitions.</p>
            )}
          </details>
          <details>
            <summary>
              Movement reviews and associated documentation (
              {history.movements.length})
            </summary>
            {history.movements.map(({ movement, charts }) => (
              <article key={movement.id}>
                <strong>
                  {words(movement.classification)} /{" "}
                  {words(movement.verificationStatus)}
                </strong>
                <p>
                  {time(movement.capturedAt)} /{" "}
                  {movement.reviewRequired
                    ? "Review rule applies"
                    : "No automatic review requirement"}
                </p>
                {movement.reviewReasonCodes?.map((code) => (
                  <small key={code}>
                    {words(code)}
                    <br />
                  </small>
                ))}
                {charts.map((chart) => (
                  <p key={chart.id}>
                    Linked documentation: {words(chart.status)} / {chart.text}
                  </p>
                ))}
                {!charts.length && (
                  <p>
                    No associated nursing documentation. Detection and review do
                    not complete care.
                  </p>
                )}
              </article>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
