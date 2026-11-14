package care.achillea;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Original API fields are retained; new fields are additive. */
public class Model {

  public static class State {

    public List<Patient> patients = new ArrayList<>();
    public List<Task> tasks = new ArrayList<>();
    public List<Vital> vitals = new ArrayList<>();
    public List<OrientationSample> samples = new ArrayList<>();
    public List<Movement> movements = new ArrayList<>();
    public List<Chart> charts = new ArrayList<>();
    public List<Event> events = new ArrayList<>();
    public List<Device> devices = new ArrayList<>();
    public Instant demoStartedAt, serverTime;
    public long monitorTick;
  }

  public record Patient(
    String id,
    String name,
    String room,
    String unit,
    String summary,
    String nurseId,
    boolean repositionPlan,
    String carePhase,
    String scenario
  ) {
    public Patient(
      String id,
      String name,
      String room,
      String unit,
      String summary,
      String nurseId,
      boolean repositionPlan
    ) {
      this(id, name, room, unit, summary, nurseId, repositionPlan, null, null);
    }
  }

  public static class Device {

    public String id,
      patientId,
      bodyRegion,
      connectionState = "CONNECTED",
      freshness = "FRESH";
    public String mode = "SIMULATED",
      calibrationStatus = "SIMULATED_REFERENCE";
    public Instant lastSeenAt, lastSampledAt;
    public boolean manualOverride;
    public int updateIntervalSeconds = 15;
    public String reportedFreshness;

    public Device() {}

    public Device(
      String id,
      String patientId,
      String bodyRegion,
      Instant seen
    ) {
      this.id = id;
      this.patientId = patientId;
      this.bodyRegion = bodyRegion;
      this.lastSeenAt = seen;
      this.lastSampledAt = seen;
    }
  }

  public record OrientationSample(
    String id,
    String sensorId,
    String patientId,
    String bodyRegion,
    double rollDegrees,
    Instant capturedAt,
    Instant receivedAt,
    String quality,
    String mode
  ) {}

  public static class Task {

    public String id,
      patientId,
      title,
      type,
      status = "OPEN",
      priority = "ROUTINE",
      source = "SEEDED_CARE_PLAN",
      deferReason,
      verifiedBy,
      completedAt;
    public Instant dueAt;
    public boolean verificationRequired;
    public int order;
    public String scheduleState, relatedDeviceId, relatedMovementId;

    public Task() {}

    public Task(
      String id,
      String patientId,
      String title,
      String type,
      Instant dueAt,
      boolean verify,
      int order
    ) {
      this.id = id;
      this.patientId = patientId;
      this.title = title;
      this.type = type;
      this.dueAt = dueAt;
      this.verificationRequired = verify;
      this.order = order;
    }
  }

  public record Vital(
    String id,
    String patientId,
    String metric,
    double value,
    String unit,
    Instant observedAt,
    Instant receivedAt,
    String source,
    String sourceEventId,
    String quality,
    String sourceId
  ) {
    public Vital(
      String id,
      String patientId,
      String metric,
      double value,
      String unit,
      Instant observedAt,
      Instant receivedAt,
      String source,
      String sourceEventId,
      String quality
    ) {
      this(
        id,
        patientId,
        metric,
        value,
        unit,
        observedAt,
        receivedAt,
        source,
        sourceEventId,
        quality,
        "monitor-" + patientId
      );
    }
  }

  public static class Movement {

    public String id,
      patientId,
      classification,
      quality,
      verificationStatus = "UNREVIEWED",
      reviewerId,
      reviewedAt,
      chestSensorId,
      pelvisSensorId;
    public double chestBefore, pelvisBefore, chestAfter, pelvisAfter;
    public Instant capturedAt, receivedAt;
    public Double confidence;
    public List<String> sampleIds = new ArrayList<>();
    public boolean reviewRequired;
    public List<String> reviewReasonCodes = new ArrayList<>();
  }

  public static class Chart {

    public String id,
      patientId,
      nurseId = "nurse-demo",
      type,
      text,
      status = "DRAFT",
      linkedTaskId,
      linkedMovementId,
      amendmentOfId;
    public List<String> linkedVitalIds = new ArrayList<>();
    public Instant authoredAt, confirmedAt;
    public String provenance = "MANUAL_ENTRY";
  }

  public record Event(
    String id,
    String patientId,
    String type,
    String source,
    String details,
    Instant timestamp
  ) {}

  public record Draft(
    String patientId,
    String type,
    String text,
    String linkedTaskId,
    List<String> linkedVitalIds,
    String linkedMovementId
  ) {}

  public record Observation(
    String sourceEventId,
    String patientId,
    String metric,
    double value,
    String unit,
    Instant observedAt,
    String quality
  ) {}

  public record Command(
    String reason,
    String text,
    Boolean verified,
    String movementId,
    String status,
    Integer order,
    String priority
  ) {}

  public record Round(
    Task task,
    String reason,
    int rank,
    String horizon,
    List<String> reasonCodes
  ) {
    public Round(Task task, String reason, int rank, String horizon) {
      this(task, reason, rank, horizon, List.of());
    }

    public Round(Task task, String reason, int rank) {
      this(
        task,
        reason,
        rank,
        rank <= 1 ? "NOW" : rank == 2 ? "NEXT" : "LATER",
        List.of()
      );
    }
  }
}
