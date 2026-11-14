package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.List;
import org.springframework.stereotype.Component;

/** Fixed fictional scenario definitions; every date is relative to the reset clock. */
@Component
public class DemoSeeder {

  public State create(Instant now) {
    State s = new State();
    s.demoStartedAt = now;
    String[] ld = {
      "Maya Rowan",
      "Elena Vale",
      "Iris Fern",
      "Nora Brook",
      "June Wren",
      "Ada Moss",
      "Lila Reed",
      "Eva Briar",
      "Cora Glen",
      "Esme Hazel",
    };
    String[] icu = {
      "Alex Linden",
      "Robin Ash",
      "Sam Alder",
      "Casey Birch",
      "Drew Elm",
      "Jamie Cedar",
      "Taylor Pine",
    };
    String[] phases = {
      "Labor observation",
      "Postpartum review",
      "Scheduled bedside assessment",
      "Recovery observation",
    };
    for (int i = 0; i < ld.length + icu.length; i++) {
      boolean intensive = i >= ld.length;
      int index = intensive ? i - ld.length : i;
      String id =
        "synthetic-" +
        (intensive ? "icu" : "ld") +
        "-%02d".formatted(index + 1);
      String scenario =
        index == 1
          ? "MONITOR_DISCONNECTED"
          : index == 2
            ? "OUTSTANDING_CHART_REVIEW"
            : "ROUTINE_MONITORING";
      Patient p = new Patient(
        id,
        intensive ? icu[index] : ld[index],
        "" + ((intensive ? 108 : 201) + index * (intensive ? 1 : 3)),
        intensive ? "ICU" : "L_AND_D",
        intensive
          ? "Postoperative observation and prescribed positioning review"
          : phases[index % phases.length] + " and comfort documentation",
        index < 3 ? "nurse-demo" : "nurse-census",
        intensive,
        intensive ? "Postoperative recovery" : phases[index % phases.length],
        scenario
      );
      s.patients.add(p);
      Device monitor = new Device(
        "monitor-" + id,
        id,
        "BEDSIDE_MONITOR",
        now.minusSeconds(2)
      );
      if (index == 1) {
        monitor.connectionState = "DISCONNECTED";
        monitor.lastSeenAt = now.minusSeconds(420);
        monitor.lastSampledAt = now.minusSeconds(422);
      }
      if (index == 2) {
        monitor.connectionState = "DELAYED";
        monitor.lastSeenAt = now.minusSeconds(100);
        monitor.lastSampledAt = now.minusSeconds(190);
      }
      s.devices.add(monitor);
      if (intensive) {
        s.devices.add(
          new Device(chestId(id), id, "UPPER_TORSO", now.minusSeconds(600))
        );
        s.devices.add(
          new Device(pelvisId(id), id, "PELVIS", now.minusSeconds(600))
        );
      }
      seedVitals(s, p, monitor, i, now);
      Vital newest = s.vitals.getLast();
      monitor.lastSeenAt = newest.receivedAt();
      monitor.lastSampledAt = newest.observedAt();
      seedTasks(s, p, i, now);
      seedChart(s, p, index, now);
      if (!monitor.connectionState.equals("CONNECTED")) s.events.add(
        new Event(
          "seed-connection-" + id,
          id,
          "device." + monitor.connectionState.toLowerCase(),
          "SIMULATED_MONITOR",
          monitor.connectionState + " · last received " + monitor.lastSeenAt,
          now.minusSeconds(60)
        )
      );
    }
    for (Patient p : s.patients)
      if (p.repositionPlan()) seedMovement(s, p, now);
    s.events.sort(
      java.util.Comparator.comparing(Event::timestamp).thenComparing(Event::id)
    );
    s.events.add(
      new Event(
        "seed-reset",
        null,
        "demo.reset",
        "SIMULATOR",
        "Synthetic scenario restored relative to reset time",
        now
      )
    );
    return s;
  }

  private void seedVitals(
    State s,
    Patient p,
    Device device,
    int index,
    Instant now
  ) {
    for (int minute = 60; minute >= 0; minute -= 2) {
      Instant at = now.minusSeconds(
        minute * 60L +
          (device.connectionState.equals("DISCONNECTED")
            ? 422
            : device.connectionState.equals("DELAYED")
              ? 190
              : 2)
      );
      double wave = Math.sin((60 - minute) / 9.0 + index);
      addVital(
        s,
        p,
        "HEART_RATE",
        Math.rint(72 + (index % 6) * 3 + wave * 5),
        "bpm",
        at,
        minute
      );
      addVital(s, p, "SPO2", 97 + ((index + minute / 2) % 3), "%", at, minute);
      addVital(
        s,
        p,
        "RESPIRATORY_RATE",
        14 + ((index + minute / 6) % 5),
        "breaths/min",
        at,
        minute
      );
      // Sampled historical arrival events reference genuine observations, rather than decorative activity.
      if (minute % 10 == 0) s.events.add(
        new Event(
          "seed-monitor-event-" + p.id() + "-" + minute,
          p.id(),
          "vital.received",
          "SIMULATED_MONITOR",
          "Historical synthetic monitor observations received from " +
            device.id,
          at.plusSeconds(2)
        )
      );
    }
  }

  private void addVital(
    State s,
    Patient p,
    String metric,
    double value,
    String unit,
    Instant at,
    int minute
  ) {
    String id = "seed-vital-" + p.id() + "-" + metric + "-" + minute;
    s.vitals.add(
      new Vital(
        id,
        p.id(),
        metric,
        value,
        unit,
        at,
        at.plusSeconds(2),
        "SIMULATED_MONITOR",
        id,
        "VALID"
      )
    );
  }

  private void seedTasks(State s, Patient p, int index, Instant now) {
    long[] offsets = { -300, 900, 5400 };
    for (int n = 0; n < 3; n++) {
      String id = "seed-task-" + p.id() + "-" + n;
      if (p.id().equals("synthetic-ld-01")) id =
        n == 0 ? "task-1" : n == 2 ? "task-4" : id;
      if (p.id().equals("synthetic-ld-02") && n == 1) id = "task-2";
      if (p.id().equals("synthetic-icu-01") && n == 0) id = "task-3";
      boolean turn = p.repositionPlan() && n == 0;
      Task t = new Task(
        id,
        p.id(),
        turn
          ? "Review prescribed repositioning"
          : n == 0
            ? "Review bedside observations"
            : n == 1
              ? "Comfort and care-plan review"
              : "Document bedside assessment",
        turn ? "REPOSITION_REVIEW" : n == 2 ? "DOCUMENTATION" : "ASSESSMENT",
        now.plusSeconds(offsets[n] + (index % 3) * 45L),
        turn,
        index * 3 + n
      );
      // A historical completed assessment never stands in for verified repositioning.
      if (!turn && n == 0 && index % 3 == 1) {
        t.status = "COMPLETED";
        t.completedAt = now.minusSeconds(180).toString();
        t.verifiedBy = p.nurseId();
      } else if (n == 1 && index % 3 == 1) t.status = "ACKNOWLEDGED";
      else if (n == 2 && index % 3 == 2) {
        t.status = "DEFERRED";
        t.deferReason =
          "Synthetic patient requested later documentation review";
      }
      s.tasks.add(t);
      s.events.add(
        new Event(
          "seed-task-created-" + id,
          p.id(),
          "task.created",
          "SEEDED_CARE_PLAN",
          t.title,
          now.minusSeconds(2400)
        )
      );
      if (!t.status.equals("OPEN")) s.events.add(
        new Event(
          "seed-task-event-" + id,
          p.id(),
          "task." + t.status.toLowerCase(),
          p.nurseId(),
          t.title + " · " + t.status,
          now.minusSeconds(180)
        )
      );
      if (t.status.equals("COMPLETED")) {
        Chart c = new Chart();
        c.id = "seed-completion-" + id;
        c.patientId = p.id();
        c.nurseId = p.nurseId();
        c.type = "TASK_COMPLETION";
        c.text =
          "Historical synthetic bedside assessment verified by assigned demo nurse";
        c.status = "CONFIRMED";
        c.authoredAt = c.confirmedAt = now.minusSeconds(180);
        c.linkedTaskId = id;
        c.provenance = "NURSE_VERIFIED_CARE";
        s.charts.add(c);
      }
    }
  }

  private void seedChart(State s, Patient p, int index, Instant now) {
    Chart c = new Chart();
    c.id = "seed-chart-" + p.id();
    c.patientId = p.id();
    c.nurseId = p.nurseId();
    c.type = "OBSERVATION";
    c.text =
      "Synthetic bedside review: " +
      p.carePhase() +
      ". Source observations reviewed; no treatment recommendation generated.";
    // Link a measurement that actually predates the draft, including for delayed/disconnected monitors.
    Vital linked = s.vitals
      .stream()
      .filter(
        v ->
          v.patientId().equals(p.id()) &&
          v.metric().equals("HEART_RATE") &&
          v.observedAt().isBefore(now.minusSeconds(1200))
      )
      .reduce((a, b) -> b)
      .orElseThrow();
    c.authoredAt = now.minusSeconds(1200);
    c.status = index % 3 == 2 ? "DRAFT" : "CONFIRMED";
    c.confirmedAt = c.status.equals("CONFIRMED")
      ? now.minusSeconds(1100)
      : null;
    c.linkedVitalIds = List.of(linked.id());
    c.provenance =
      "MANUAL_ENTRY + SIMULATED_MONITOR (linked immutable observations)";
    s.charts.add(c);
    s.events.add(
      new Event(
        "seed-chart-created-" + p.id(),
        p.id(),
        "chart.created",
        p.nurseId(),
        "Synthetic bedside draft created",
        c.authoredAt
      )
    );
    if (c.confirmedAt != null) s.events.add(
      new Event(
        "seed-chart-event-" + p.id(),
        p.id(),
        "chart.confirmed",
        p.nurseId(),
        "Synthetic bedside observation confirmed",
        c.confirmedAt
      )
    );
  }

  private void seedMovement(State s, Patient p, Instant now) {
    Movement m = new Movement();
    m.id = "seed-movement-" + p.id();
    m.patientId = p.id();
    m.capturedAt = now.minusSeconds(600);
    m.receivedAt = m.capturedAt.plusSeconds(1);
    m.chestAfter = 12;
    m.pelvisAfter = 0;
    m.classification = "PARTIAL_TORSO_MOVEMENT";
    m.quality = "SIMULATED_GOOD";
    m.confidence = .85;
    m.chestSensorId = chestId(p.id());
    m.pelvisSensorId = pelvisId(p.id());
    m.sampleIds = List.of(m.id + "-chest", m.id + "-pelvis");
    s.movements.add(m);
    s.samples.add(
      new OrientationSample(
        m.sampleIds.get(0),
        m.chestSensorId,
        p.id(),
        "UPPER_TORSO",
        12,
        m.capturedAt,
        m.receivedAt,
        m.quality,
        "SIMULATED"
      )
    );
    s.samples.add(
      new OrientationSample(
        m.sampleIds.get(1),
        m.pelvisSensorId,
        p.id(),
        "PELVIS",
        0,
        m.capturedAt,
        m.receivedAt,
        m.quality,
        "SIMULATED"
      )
    );
    s.events.add(
      new Event(
        "seed-detection-" + p.id(),
        p.id(),
        "movement.detected",
        "SIMULATED_SENSOR",
        "Partial torso movement · prototype heuristic · awaiting nurse review",
        m.capturedAt
      )
    );
  }

  static String chestId(String patientId) {
    return patientId.equals("synthetic-icu-01")
      ? "torso-sim-01"
      : "torso-" + patientId;
  }

  static String pelvisId(String patientId) {
    return patientId.equals("synthetic-icu-01")
      ? "pelvis-sim-01"
      : "pelvis-" + patientId;
  }
}
