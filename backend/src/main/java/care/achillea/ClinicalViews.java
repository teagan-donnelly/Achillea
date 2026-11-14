package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;

/** Derived presentation only: never mutates or replaces the underlying audit log. */
public final class ClinicalViews {

  private ClinicalViews() {}

  public record ActivityItem(
    String id,
    String patientId,
    String category,
    String type,
    String sourceId,
    Instant startedAt,
    Instant timestamp,
    int count,
    String summary,
    List<String> measurementIds,
    List<String> sourceEventIds,
    List<String> rawEventIds
  ) {}

  public static List<ActivityItem> activity(State s) {
    Map<String, List<Vital>> groups = new LinkedHashMap<>();
    List<ActivityItem> result = new ArrayList<>();
    for (Vital v : s.vitals) {
      if ("VALID".equals(v.quality())) {
        String key =
          v.patientId() +
          "/" +
          v.sourceId() +
          "/" +
          Math.floorDiv(v.receivedAt().getEpochSecond(), 900);
        groups.computeIfAbsent(key, ignored -> new ArrayList<>()).add(v);
      } else {
        result.add(
          new ActivityItem(
            v.id(),
            v.patientId(),
            "MEASUREMENT",
            "measurement.quality",
            v.sourceId(),
            v.observedAt(),
            v.receivedAt(),
            1,
            v.metric() + ": " + v.quality() + " (synthetic)",
            List.of(v.id()),
            v.sourceEventId() == null ? List.of() : List.of(v.sourceEventId()),
            List.of()
          )
        );
      }
    }
    groups.forEach((key, values) -> {
      Vital first = values.get(0);
      Instant start = values
        .stream()
        .map(Vital::receivedAt)
        .min(Instant::compareTo)
        .orElseThrow();
      Instant end = values
        .stream()
        .map(Vital::receivedAt)
        .max(Instant::compareTo)
        .orElseThrow();
      result.add(
        new ActivityItem(
          "monitoring/" + key,
          first.patientId(),
          "MONITORING_SUMMARY",
          "monitoring.summary",
          first.sourceId(),
          start,
          end,
          values.size(),
          values.size() +
            " synthetic measurements received in this 15-minute window",
          values.stream().map(Vital::id).toList(),
          values
            .stream()
            .map(Vital::sourceEventId)
            .filter(Objects::nonNull)
            .toList(),
          List.of()
        )
      );
    });
    for (Event e : s.events) {
      // Raw routine arrivals remain available through /events and /monitoring/updates.
      // Counts come from measurements, never from the number of arrival events.
      if (e.type().equals("vital.received")) continue;
      String category = e.type().startsWith("device.")
        ? "DEVICE_STATUS"
        : e.type().startsWith("task.")
          ? "TASK_ATTENTION"
          : e.type().startsWith("movement.")
            ? "SENSOR_REVIEW"
            : e.type().startsWith("chart.")
              ? "DOCUMENTATION"
              : "ACTIVITY";
      result.add(
        new ActivityItem(
          e.id(),
          e.patientId(),
          category,
          e.type(),
          e.source(),
          e.timestamp(),
          e.timestamp(),
          1,
          e.details(),
          List.of(),
          List.of(),
          List.of(e.id())
        )
      );
    }
    result.sort(
      Comparator.comparing(ActivityItem::timestamp)
        .reversed()
        .thenComparing(ActivityItem::id)
    );
    return result;
  }

  public static List<String> roundReasons(Task t, State s, Instant now) {
    List<String> codes = new ArrayList<>();
    if ("HIGH".equals(t.priority)) codes.add("EXPLICIT_HIGH_PRIORITY");
    if (!t.dueAt.isAfter(now)) codes.add(
      t.dueAt.equals(now) ? "SCHEDULED_DUE" : "SCHEDULED_OVERDUE"
    );
    else if (!t.dueAt.isAfter(now.plusSeconds(1800))) codes.add(
      "DUE_WITHIN_30_MINUTES"
    );
    else codes.add("ROUTINE_SEQUENCE");
    if ("TIMELY".equals(t.priority)) codes.add("EXPLICIT_TIMELY_PRIORITY");
    if ("DEFERRED".equals(t.status)) codes.add("NURSE_DEFERRED");
    if ("ACKNOWLEDGED".equals(t.status)) codes.add("NURSE_ACKNOWLEDGED");
    if (t.relatedMovementId != null) codes.add("SENSOR_REVIEW_REQUIRED");
    if (t.relatedDeviceId != null) codes.add("TECHNICAL_DEVICE_REVIEW");
    if (
      s.devices
        .stream()
        .anyMatch(
          d ->
            d.patientId.equals(t.patientId) &&
            !"CONNECTED".equals(d.connectionState)
        )
    ) codes.add("DEVICE_CONNECTION_REVIEW");
    return List.copyOf(codes);
  }
}
