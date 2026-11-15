package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;

/** Explicit workflow rules, not a medical risk model. Care is never completed here. */
final class WorkflowRules {

  private WorkflowRules() {}

  static void classify(Movement m) {
    List<String> codes = new ArrayList<>();
    if (!"SIMULATED_GOOD".equals(m.quality)) codes.add(
      "INCOMPLETE_OR_UNCERTAIN_EVIDENCE"
    );
    if ("COORDINATED_TURN_CANDIDATE".equals(m.classification)) codes.add(
      "COORDINATED_MOVEMENT_REQUIRES_BEDSIDE_REVIEW"
    );
    if (
      "PARTIAL_TORSO_MOVEMENT".equals(m.classification) ||
      "PARTIAL_PELVIC_MOVEMENT".equals(m.classification)
    ) codes.add("REGION_ONLY_MOVEMENT");
    m.reviewReasonCodes = codes;
    m.reviewRequired = !codes.isEmpty();
  }

  static void apply(State s, Instant now) {
    Set<String> assigned = new HashSet<>();
    s.patients
      .stream()
      .filter(p -> "nurse-demo".equals(p.nurseId()))
      .forEach(p -> assigned.add(p.id()));
    for (Device d : s.devices) {
      if (!assigned.contains(d.patientId)) continue;
      if (!Objects.equals(d.freshness, d.reportedFreshness)) {
        if (
          d.reportedFreshness != null || !"FRESH".equals(d.freshness)
        ) MonitorSimulation.audit(
          s,
          d.patientId,
          "device.freshness",
          d.id + ": " + d.freshness + " by last sampled time",
          now
        );
        d.reportedFreshness = d.freshness;
      }
      if (
        !"CONNECTED".equals(d.connectionState) ||
        Set.of("STALE", "UNKNOWN").contains(d.freshness)
      ) {
        boolean exists = s.tasks
          .stream()
          .anyMatch(t -> d.id.equals(t.relatedDeviceId) && active(t));
        if (!exists) {
          Task t = new Task(
            UUID.randomUUID().toString(),
            d.patientId,
            "Review simulated device connection and data freshness",
            "DEVICE_REVIEW",
            now,
            false,
            0
          );
          t.source = "TECHNICAL_DEVICE_RULE";
          t.relatedDeviceId = d.id;
          s.tasks.add(t);
          MonitorSimulation.audit(
            s,
            d.patientId,
            "task.created",
            "Technical review for " + d.id + "; no clinical urgency inferred",
            now
          );
        }
      }
    }
    for (Movement m : s.movements) {
      classify(m);
      if (
        !assigned.contains(m.patientId) ||
        !m.reviewRequired ||
        !Set.of("UNREVIEWED", "NEEDS_REVIEW").contains(m.verificationStatus)
      ) continue;
      if (
        s.tasks.stream().anyMatch(t -> m.id.equals(t.relatedMovementId))
      ) continue;
      Task t = new Task(
        UUID.randomUUID().toString(),
        m.patientId,
        "Review synthetic movement evidence at bedside",
        "SENSOR_REVIEW",
        now,
        false,
        0
      );
      t.source = "SENSOR_REVIEW_RULE";
      t.relatedMovementId = m.id;
      s.tasks.add(t);
      MonitorSimulation.audit(
        s,
        m.patientId,
        "task.created",
        "Review movement " +
          m.id +
          ": " +
          String.join(",", m.reviewReasonCodes),
        now
      );
    }
    for (Task t : s.tasks) {
      if (!assigned.contains(t.patientId) || !active(t)) continue;
      String state = t.dueAt.isBefore(now)
        ? "OVERDUE"
        : t.dueAt.equals(now)
          ? "DUE"
          : t.dueAt.isAfter(now.plusSeconds(1800))
            ? "LATER"
            : "UPCOMING";
      if (!state.equals(t.scheduleState)) {
        // Existing snapshots acquire a baseline silently; subsequent transitions are auditable.
        if (
          t.scheduleState != null || Set.of("DUE", "OVERDUE").contains(state)
        ) MonitorSimulation.audit(
          s,
          t.patientId,
          "task.schedule." + state.toLowerCase(Locale.ROOT),
          t.id + ": " + t.title + " - " + state + " by scheduled time",
          now
        );
        t.scheduleState = state;
      }
    }
  }

  static boolean active(Task t) {
    return !Set.of("COMPLETED", "CANCELLED").contains(t.status);
  }
}
