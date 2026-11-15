package care.achillea;

import static care.achillea.Model.*;

import java.time.*;
import java.util.*;

/** Fictional individualized care plans, independent of movement interpretation. */
public final class Repositioning {

  private Repositioning() {}

  public static class Plan {

    public String patientId, confirmedMovementId, confirmedChartId;
    public int intervalMinutes,
      warningMinutes = 30;
    public Instant initialDueAt, lastConfirmedCareAt;
  }

  public record Status(
    String patientId,
    String scheduleStatus,
    String evidenceStatus,
    Instant nextDueAt,
    Instant lastConfirmedCareAt,
    int intervalMinutes,
    int warningMinutes,
    long overdueSeconds,
    boolean reporting,
    String lastRecordedPosition,
    String latestMovementId,
    int pendingReviews
  ) {}

  static void initialize(State s, Instant now) {
    if (s.repositioningPlans == null) s.repositioningPlans = new ArrayList<>();
    for (Patient p : s.patients) {
      if (
        !p.repositionPlan() ||
        s.repositioningPlans.stream().anyMatch(x -> x.patientId.equals(p.id()))
      ) continue;
      Plan plan = new Plan();
      plan.patientId = p.id();
      // Synthetic clinician-configured examples, never a universal care recommendation.
      plan.intervalMinutes = p.id().endsWith("02")
        ? 180
        : p.id().endsWith("03")
          ? 90
          : 120;
      plan.initialDueAt = s.tasks
        .stream()
        .filter(
          t ->
            t.patientId.equals(p.id()) &&
            t.type.startsWith("REPOSITION") &&
            WorkflowRules.active(t)
        )
        .map(t -> t.dueAt)
        .min(Comparator.naturalOrder())
        .orElse(
          (s.demoStartedAt == null ? now : s.demoStartedAt).plusSeconds(
            plan.intervalMinutes * 60L
          )
        );
      s.repositioningPlans.add(plan);
    }
  }

  public static Status status(State s, Patient p, Instant now) {
    Plan plan = s.repositioningPlans
      .stream()
      .filter(x -> x.patientId.equals(p.id()))
      .findFirst()
      .orElse(null);
    Instant due =
      plan == null
        ? null
        : plan.lastConfirmedCareAt == null
          ? plan.initialDueAt
          : plan.lastConfirmedCareAt.plusSeconds(plan.intervalMinutes * 60L);
    String schedule =
      !p.repositionPlan() || due == null
        ? "UNKNOWN"
        : now.isAfter(due)
          ? "OVERDUE"
          : !now.isBefore(due.minusSeconds(plan.warningMinutes * 60L))
            ? "DUE_SOON"
            : "ON_TRACK";
    List<Device> devices = s.devices
      .stream()
      .filter(
        d ->
          d.patientId.equals(p.id()) && !"BEDSIDE_MONITOR".equals(d.bodyRegion)
      )
      .toList();
    boolean reporting =
      devices.stream().anyMatch(d -> "UPPER_TORSO".equals(d.bodyRegion)) &&
      devices.stream().anyMatch(d -> "PELVIS".equals(d.bodyRegion)) &&
      devices
        .stream()
        .allMatch(
          d ->
            "CONNECTED".equals(d.connectionState) &&
            "FRESH".equals(d.freshness) &&
            d.lastSampledAt != null &&
            !d.lastSampledAt.isBefore(now.minusSeconds(120))
        );
    List<Movement> movements = s.movements
      .stream()
      .filter(m -> m.patientId.equals(p.id()))
      .sorted(Comparator.comparing(m -> m.capturedAt))
      .toList();
    Movement latest = movements.isEmpty() ? null : movements.getLast();
    int pending = (int) movements
      .stream()
      .filter(m ->
        Set.of("UNREVIEWED", "NEEDS_REVIEW").contains(m.verificationStatus)
      )
      .count();
    String evidence = !reporting
      ? "SENSOR_UNAVAILABLE"
      : latest == null
        ? "NO_HISTORY"
        : !"SIMULATED_GOOD".equals(latest.quality)
          ? "UNCERTAIN"
          : latest.classification.startsWith("PARTIAL")
            ? "REGION_DISCREPANCY"
            : pending > 0
              ? "NEEDS_REVIEW"
              : "REVIEWED";
    // Roll readings are shown numerically; no unsupported anatomical orientation inferred.
    String position =
      latest == null
        ? "Unknown"
        : "Last simulated roll: chest " +
          latest.chestAfter +
          "°, pelvis " +
          latest.pelvisAfter +
          "°";
    return new Status(
      p.id(),
      schedule,
      evidence,
      due,
      plan == null ? null : plan.lastConfirmedCareAt,
      plan == null ? 0 : plan.intervalMinutes,
      plan == null ? 0 : plan.warningMinutes,
      due == null ? 0 : Math.max(0, Duration.between(due, now).getSeconds()),
      reporting,
      position,
      latest == null ? null : latest.id,
      pending
    );
  }

  static List<Status> queue(State s, Instant now, String unit) {
    return s.patients
      .stream()
      .filter(p -> unit.equals(p.unit()))
      .map(p -> status(s, p, now))
      .sorted(
        Comparator.comparing(
          Status::nextDueAt,
          Comparator.nullsLast(Comparator.naturalOrder())
        ).thenComparing(Status::patientId)
      )
      .toList();
  }
}
