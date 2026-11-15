package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Read-only views assembled from the one shared record: monitoring alerts with their lifecycle,
 * and the source-linked context a handoff is prepared from. Nothing here writes or infers care.
 *
 * <p>Alert lifecycle states are distinct and derived from records: FLAGGED (rule fired, nobody has
 * reviewed), ACKNOWLEDGED (nurse reviewed; an audit event), FOLLOW_UP_DOCUMENTED (a confirmed chart
 * entry is linked), RESOLVED (task completed or cancelled). CARRIED_FORWARD is a flag: still open
 * after a handoff was acknowledged. A documentation gap means acknowledged without linked follow-up
 * documentation; it does not mean care was not performed.
 */
final class ShiftContext {

  private ShiftContext() {}

  static final String NOT_DOCUMENTED = null;

  static boolean acknowledged(State s, Task t) {
    return s.events.stream().anyMatch(e -> e.type().equals("alert.acknowledged") && e.id().equals("ack:" + t.id));
  }

  static Optional<Event> ackEvent(State s, Task t) {
    return s.events.stream().filter(e -> e.id().equals("ack:" + t.id)).findFirst();
  }

  static List<Chart> followUps(State s, Task t) {
    return s.charts.stream()
      .filter(c -> t.id.equals(c.linkedTaskId) && !"DRAFT".equals(c.status) && !"TASK_COMPLETION".equals(c.type))
      .toList();
  }

  static Map<String, Object> alert(State s, Task t, Patient p) {
    Event evidence = s.events.stream().filter(e -> e.id().equals("evidence:" + t.id)).findFirst().orElse(null);
    String details = evidence == null ? t.title : evidence.details();
    List<String> ids = List.of();
    int cut = details.indexOf(" evidence=");
    if (cut >= 0) {
      ids = Arrays.asList(details.substring(cut + 10).split(","));
      details = details.substring(0, cut);
    }
    Set<String> idSet = new HashSet<>(ids);
    List<Map<String, Object>> readings = s.vitals.stream().filter(v -> idSet.contains(v.id())).map(ShiftContext::vital).toList();
    List<Chart> follow = followUps(s, t);
    boolean ack = acknowledged(s, t);
    boolean active = WorkflowRules.active(t);
    String state = !active ? "RESOLVED" : !follow.isEmpty() ? "FOLLOW_UP_DOCUMENTED" : ack ? "ACKNOWLEDGED" : "FLAGGED";
    boolean carried = active && s.handoffs.stream().anyMatch(h ->
      h.patientId.equals(t.patientId) && h.acknowledgedAt != null && h.acknowledgedAt.isAfter(t.dueAt));
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", t.id);
    m.put("patientId", t.patientId);
    m.put("patientName", p == null ? null : p.name());
    m.put("room", p == null ? null : p.room());
    m.put("rule", t.id.split(":").length > 1 ? t.id.split(":")[1] : null);
    m.put("title", t.title);
    m.put("details", details);
    m.put("detectedAt", t.dueAt);
    m.put("source", evidence == null ? t.source : evidence.source());
    m.put("evidence", readings);
    m.put("state", state);
    m.put("acknowledged", ack);
    ackEvent(s, t).ifPresent(e -> {
      m.put("acknowledgedAt", e.timestamp());
      m.put("acknowledgedBy", e.source());
    });
    m.put("followUpChartIds", follow.stream().map(c -> c.id).toList());
    m.put("documentationGap", active && ack && follow.isEmpty());
    m.put("carriedForward", carried);
    m.put("resolvedAt", t.completedAt);
    return m;
  }

  static boolean recorded(Vital v) {
    return v.sourceEventId() != null && v.sourceEventId().startsWith(ReplayEngine.PREFIX);
  }

  static Map<String, Object> vital(Vital v) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", v.id());
    m.put("metric", v.metric());
    m.put("value", v.value());
    m.put("unit", v.unit());
    m.put("observedAt", v.observedAt());
    m.put("recordedMinute", ReplayEngine.recordedMinute(v.sourceEventId()));
    m.put("source", v.source());
    m.put("quality", v.quality());
    return m;
  }

  static List<Map<String, Object>> alerts(State s, String patientId) {
    Map<String, Patient> patients = s.patients.stream().collect(Collectors.toMap(Patient::id, p -> p));
    return s.tasks.stream()
      .filter(t -> MonitorAnalysis.TYPE.equals(t.type) && (patientId == null || patientId.equals(t.patientId)))
      .filter(t -> patients.containsKey(t.patientId))
      .sorted(Comparator.comparing((Task t) -> t.dueAt).reversed())
      .map(t -> alert(s, t, patients.get(t.patientId)))
      .toList();
  }

  // ---------------------------------------------------------------- handoff context

  private static Map<String, Object> field(String key, String label, String value, String source) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("key", key);
    m.put("label", label);
    m.put("value", value);
    m.put("source", value == null ? null : source);
    return m;
  }

  private static Map<String, Object> item(String id, String title, String detail, String sourceType, String sourceId,
                                          Instant at, String status, String responsible, Instant due) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", id);
    m.put("title", title);
    m.put("detail", detail);
    m.put("sourceType", sourceType);
    m.put("sourceId", sourceId);
    m.put("timestamp", at);
    m.put("status", status);
    m.put("responsible", responsible);
    m.put("dueAt", due);
    return m;
  }

  static Map<String, Object> handoff(State s, Patient p, Instant now, Map<String, Object> replay) {
    String pid = p.id();
    Instant since = now.minusSeconds(12 * 3600);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("patientId", pid);
    out.put("generatedAt", now);

    // Snapshot: only what the record actually holds; everything else is "not documented" (null).
    List<Device> devices = s.devices.stream().filter(d -> d.patientId.equals(pid)).toList();
    Repositioning.Plan plan = s.repositioningPlans.stream().filter(x -> x.patientId.equals(pid)).findFirst().orElse(null);
    List<Map<String, Object>> snapshot = new ArrayList<>();
    snapshot.add(field("admission", "Admission reason", p.summary(), "Patient record"));
    snapshot.add(field("carePhase", "Care phase", p.carePhase(), "Patient record"));
    snapshot.add(field("history", "Pertinent history", NOT_DOCUMENTED, null));
    snapshot.add(field("allergies", "Allergies and reactions", NOT_DOCUMENTED, null));
    snapshot.add(field("codeStatus", "Code status", NOT_DOCUMENTED, null));
    snapshot.add(field("isolation", "Isolation precautions", NOT_DOCUMENTED, null));
    snapshot.add(field("fallSkin", "Fall and skin risk", plan == null ? NOT_DOCUMENTED
      : "Repositioning plan every " + plan.intervalMinutes + " min (skin protection)", "Repositioning plan"));
    snapshot.add(field("mobility", "Mobility and assistance", p.repositionPlan() ? "Needs assisted repositioning" : NOT_DOCUMENTED, "Care plan"));
    snapshot.add(field("mental", "Mental status and orientation", NOT_DOCUMENTED, null));
    snapshot.add(field("devices", "Lines, drains and devices", devices.isEmpty() ? NOT_DOCUMENTED
      : devices.stream().map(d -> d.bodyRegion.equals("BEDSIDE_MONITOR") ? "Bedside monitor" : d.bodyRegion.equals("PELVIS") ? "Pelvis motion sensor" : "Torso motion sensor")
          .collect(Collectors.joining(", ")) + " (demo devices)", "Device registry"));
    snapshot.add(field("oxygen", "Oxygen support", NOT_DOCUMENTED, null));
    snapshot.add(field("diet", "Diet and fluid restrictions", NOT_DOCUMENTED, null));
    snapshot.add(field("safety", "Safety considerations", NOT_DOCUMENTED, null));
    out.put("snapshot", snapshot);

    // Shift activity
    Map<String, Object> activity = new LinkedHashMap<>();
    Map<String, Vital> latest = new LinkedHashMap<>();
    for (Vital v : s.vitals) if (v.patientId().equals(pid)) {
      Vital prev = latest.get(v.metric());
      if (prev == null || !v.observedAt().isBefore(prev.observedAt())) latest.put(v.metric(), v);
    }
    activity.put("latestVitals", latest.values().stream().map(ShiftContext::vital).toList());
    List<Vital> shiftVitals = s.vitals.stream()
      .filter(v -> v.patientId().equals(pid) && v.observedAt().isAfter(since) && !"MISSING".equals(v.quality()))
      .sorted(Comparator.comparing(Vital::observedAt)).toList();
    // A patient with a recording is summarised from the recording only, never mixed with seeded history.
    if (shiftVitals.stream().anyMatch(ShiftContext::recorded))
      shiftVitals = shiftVitals.stream().filter(ShiftContext::recorded).toList();
    out.put("trends", trends(shiftVitals));
    out.put("coverage", coverage(s, pid, shiftVitals, now));
    Device monitor = devices.stream().filter(d -> d.bodyRegion.equals("BEDSIDE_MONITOR")).findFirst().orElse(null);
    activity.put("monitor", monitor == null ? null : Map.of(
      "connectionState", monitor.connectionState, "freshness", Objects.toString(monitor.freshness, "UNKNOWN"),
      "mode", Objects.toString(monitor.mode, "SIMULATED")));
    activity.put("replay", replay);
    List<Map<String, Object>> alerts = alerts(s, pid);
    activity.put("alerts", alerts);
    List<Chart> charts = s.charts.stream()
      .filter(c -> c.patientId.equals(pid) && !"DRAFT".equals(c.status) && c.authoredAt != null && c.authoredAt.isAfter(since))
      .sorted(Comparator.comparing((Chart c) -> c.authoredAt).reversed()).toList();
    activity.put("assessments", charts.stream().filter(c -> Set.of("ASSESSMENT", "OBSERVATION").contains(c.type))
      .map(c -> item(c.id, words(c.type), c.text, "chart", c.id, c.authoredAt, c.status, c.nurseId, null)).toList());
    List<Map<String, Object>> care = new ArrayList<>();
    for (Task t : s.tasks) if (t.patientId.equals(pid) && "COMPLETED".equals(t.status) && t.completedAt != null)
      care.add(item(t.id, t.title, "Completed and verified by " + Objects.toString(t.verifiedBy, "nurse"), "task", t.id,
        Instant.parse(t.completedAt), "COMPLETED", t.verifiedBy, null));
    for (Chart c : charts) if ("CARE_NOTE".equals(c.type))
      care.add(item(c.id, "Care note", c.text, "chart", c.id, c.authoredAt, c.status, c.nurseId, null));
    care.sort(Comparator.comparing((Map<String, Object> m) -> (Instant) m.get("timestamp")).reversed());
    activity.put("care", care);
    activity.put("medications", charts.stream()
      .filter(c -> c.text != null && c.text.toLowerCase(Locale.ROOT).matches("(?s).*\\b(medication|administered|dose|mg|held|delayed)\\b.*"))
      .map(c -> item(c.id, "Medication note", c.text, "chart", c.id, c.authoredAt, c.status, c.nurseId, null)).toList());
    Movement lastMove = s.movements.stream().filter(m -> m.patientId.equals(pid)).max(Comparator.comparing(m -> m.capturedAt)).orElse(null);
    Map<String, Object> movement = new LinkedHashMap<>();
    movement.put("lastSensorMovement", lastMove == null ? null : item(lastMove.id, words(lastMove.classification),
      "Sensor-detected; " + words(lastMove.verificationStatus) + ". Sensor movement is not proof of repositioning care.",
      "movement", lastMove.id, lastMove.capturedAt, lastMove.verificationStatus, null, null));
    movement.put("lastConfirmedRepositioning", plan == null ? null : plan.lastConfirmedCareAt);
    movement.put("openRepositioningTasks", s.tasks.stream().filter(t -> t.patientId.equals(pid) && t.type.startsWith("REPOSITION") && WorkflowRules.active(t)).count());
    movement.put("sensors", devices.stream().filter(d -> !d.bodyRegion.equals("BEDSIDE_MONITOR"))
      .map(d -> Map.of("id", d.id, "region", d.bodyRegion, "connectionState", d.connectionState, "freshness", Objects.toString(d.freshness, "UNKNOWN"))).toList());
    activity.put("movement", movement);

    // Chronological significant events (not every vital reading).
    List<Map<String, Object>> timeline = new ArrayList<>();
    for (Map<String, Object> a : alerts) {
      timeline.add(item("t-" + a.get("id"), (String) a.get("title"), (String) a.get("details"), "alert", (String) a.get("id"),
        (Instant) a.get("detectedAt"), (String) a.get("state"), null, null));
      if (a.get("acknowledgedAt") != null) timeline.add(item("t-ack-" + a.get("id"), "Alert acknowledged", (String) a.get("title"),
        "alert", (String) a.get("id"), (Instant) a.get("acknowledgedAt"), "ACKNOWLEDGED", (String) a.get("acknowledgedBy"), null));
    }
    for (Chart c : charts) timeline.add(item("t-" + c.id, words(c.type), c.text, "chart", c.id, c.authoredAt, c.status, c.nurseId, null));
    s.movements.stream().filter(m -> m.patientId.equals(pid) && m.capturedAt.isAfter(since)).forEach(m ->
      timeline.add(item("t-" + m.id, "Sensor movement: " + words(m.classification), words(m.verificationStatus), "movement", m.id, m.capturedAt, m.verificationStatus, null, null)));
    timeline.sort(Comparator.comparing((Map<String, Object> m) -> (Instant) m.get("timestamp")).reversed());
    activity.put("timeline", timeline.stream().limit(12).toList());
    out.put("activity", activity);

    // Next-shift priorities: grouped by documented priority and due time only.
    List<Map<String, Object>> prompt = new ArrayList<>(), upcoming = new ArrayList<>(), routine = new ArrayList<>();
    for (Map<String, Object> a : alerts) {
      if ("RESOLVED".equals(a.get("state"))) continue;
      boolean gap = Boolean.TRUE.equals(a.get("documentationGap"));
      Map<String, Object> it = item("p-" + a.get("id"),
        gap ? "Documentation gap: " + a.get("title") : (String) a.get("title"),
        gap ? "Acknowledged with no linked follow-up documentation. This does not mean care was not performed."
          : (String) a.get("details"),
        "alert", (String) a.get("id"), (Instant) a.get("detectedAt"), (String) a.get("state"), "nurse-demo", null);
      it.put("kind", gap ? "DOCUMENTATION_GAP" : "MONITORING_ALERT");
      (Set.of("FLAGGED", "ACKNOWLEDGED").contains((String) a.get("state")) ? prompt : upcoming).add(it);
    }
    for (Task t : s.tasks) {
      if (!t.patientId.equals(pid) || !WorkflowRules.active(t) || MonitorAnalysis.TYPE.equals(t.type)) continue;
      Map<String, Object> it = item("p-" + t.id, t.title, words(t.type) + " · " + words(t.priority), "task", t.id,
        t.dueAt, t.status, "nurse-demo", t.dueAt);
      it.put("kind", "TASK");
      if ("HIGH".equals(t.priority) || "OVERDUE".equals(t.scheduleState)) prompt.add(it);
      else if (t.dueAt != null && t.dueAt.isBefore(now.plusSeconds(2 * 3600))) upcoming.add(it);
      else routine.add(it);
    }
    s.movements.stream().filter(m -> m.patientId.equals(pid) && m.reviewRequired && Set.of("UNREVIEWED", "NEEDS_REVIEW").contains(m.verificationStatus))
      .forEach(m -> {
        Map<String, Object> it = item("p-" + m.id, "Verify sensor movement at bedside", words(m.classification) + "; unverified sensor observation",
          "movement", m.id, m.capturedAt, m.verificationStatus, null, null);
        it.put("kind", "UNVERIFIED_MOVEMENT");
        upcoming.add(it);
      });
    Map<String, Object> priorities = new LinkedHashMap<>();
    priorities.put("prompt", prompt);
    priorities.put("upcoming", upcoming);
    priorities.put("routine", routine);
    out.put("priorities", priorities);
    out.put("missing", missing(s, p, alerts, charts, plan, (Map<String, Object>) out.get("coverage"), snapshot, now));
    out.put("counts", Map.of(
      "requiresReview", prompt.size(),
      "outstandingTasks", s.tasks.stream().filter(t -> t.patientId.equals(pid) && WorkflowRules.active(t)).count(),
      "unverified", alerts.stream().filter(a -> "FLAGGED".equals(a.get("state"))).count()
        + s.movements.stream().filter(m -> m.patientId.equals(pid) && m.reviewRequired && "UNREVIEWED".equals(m.verificationStatus)).count(),
      "documentationGaps", alerts.stream().filter(a -> Boolean.TRUE.equals(a.get("documentationGap"))).count()));
    return out;
  }

  private static String words(String v) {
    if (v == null) return "";
    String w = v.toLowerCase(Locale.ROOT).replace('_', ' ');
    if (w.isEmpty()) return w;
    return Character.toUpperCase(w.charAt(0)) + w.substring(1);
  }

  /** Per metric over the shift: first, latest, range and a compact series for a sparkline. */
  static List<Map<String, Object>> trends(List<Vital> vitals) {
    Map<String, List<Vital>> by = new LinkedHashMap<>();
    for (Vital v : vitals) by.computeIfAbsent(v.metric(), k -> new ArrayList<>()).add(v);
    List<Map<String, Object>> out = new ArrayList<>();
    for (var e : by.entrySet()) {
      List<Vital> list = e.getValue();
      Vital first = list.get(0), last = list.get(list.size() - 1);
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("metric", e.getKey());
      m.put("unit", last.unit());
      m.put("first", first.value());
      m.put("firstAt", first.observedAt());
      m.put("latest", last.value());
      m.put("latestAt", last.observedAt());
      m.put("latestId", last.id());
      m.put("min", list.stream().mapToDouble(Vital::value).min().orElse(0));
      m.put("max", list.stream().mapToDouble(Vital::value).max().orElse(0));
      m.put("count", list.size());
      m.put("points", list.subList(Math.max(0, list.size() - 30), list.size()).stream().map(Vital::value).toList());
      out.add(m);
    }
    return out;
  }

  /**
   * How much of the shift the monitor actually covered. A gap is a pause between readings longer
   * than three times the usual interval (minimum 30 s), plus any open gap since the last reading.
   */
  static Map<String, Object> coverage(State s, String pid, List<Vital> vitals, Instant now) {
    Map<String, Object> m = new LinkedHashMap<>();
    List<Instant> times = vitals.stream().map(Vital::observedAt).distinct().sorted().toList();
    List<Map<String, Object>> gaps = new ArrayList<>();
    m.put("readings", vitals.size());
    if (times.size() < 2) {
      m.put("from", times.isEmpty() ? null : times.get(0));
      m.put("to", now);
      m.put("percent", times.isEmpty() ? 0 : 100);
      m.put("gaps", gaps);
      m.put("lastReadingAt", times.isEmpty() ? null : times.get(0));
      return m;
    }
    List<Long> steps = new ArrayList<>();
    for (int i = 1; i < times.size(); i++) steps.add(times.get(i).toEpochMilli() - times.get(i - 1).toEpochMilli());
    List<Long> sorted = steps.stream().sorted().toList();
    long typical = Math.max(1000, sorted.get(sorted.size() / 2));
    long limit = Math.max(30_000, typical * 3);
    long missing = 0;
    for (int i = 1; i < times.size(); i++) if (steps.get(i - 1) > limit) {
      gaps.add(Map.of("from", times.get(i - 1), "to", times.get(i), "seconds", steps.get(i - 1) / 1000, "open", false));
      missing += steps.get(i - 1) - typical;
    }
    Instant lastAt = times.get(times.size() - 1);
    long since = now.toEpochMilli() - lastAt.toEpochMilli();
    if (since > limit) {
      gaps.add(Map.of("from", lastAt, "to", now, "seconds", since / 1000, "open", true));
      missing += since - typical;
    }
    long total = Math.max(1, now.toEpochMilli() - times.get(0).toEpochMilli());
    m.put("from", times.get(0));
    m.put("to", now);
    m.put("typicalSeconds", typical / 1000);
    m.put("percent", Math.max(0, Math.min(100, Math.round(100.0 * (total - missing) / total))));
    m.put("gaps", gaps);
    m.put("lastReadingAt", lastAt);
    return m;
  }

  private static Map<String, Object> gap(String kind, String title, String detail, String sourceType, String sourceId, String action) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("kind", kind);
    m.put("title", title);
    m.put("detail", detail);
    m.put("sourceType", sourceType);
    m.put("sourceId", sourceId);
    m.put("action", action);
    return m;
  }

  /** What the record cannot show yet: data gaps and documentation gaps, each linked to a fix. */
  @SuppressWarnings("unchecked")
  static List<Map<String, Object>> missing(State s, Patient p, List<Map<String, Object>> alerts, List<Chart> charts,
                                           Repositioning.Plan plan, Map<String, Object> coverage,
                                           List<Map<String, Object>> snapshot, Instant now) {
    String pid = p.id();
    List<Map<String, Object>> out = new ArrayList<>();
    for (Map<String, Object> g : (List<Map<String, Object>>) coverage.get("gaps")) {
      long sec = ((Number) g.get("seconds")).longValue();
      String len = sec >= 120 ? (sec / 60) + " min" : sec + " s";
      out.add(gap("DATA", Boolean.TRUE.equals(g.get("open")) ? "No monitor data for " + len : "Monitor data gap of " + len,
        "From " + g.get("from") + (Boolean.TRUE.equals(g.get("open")) ? " until now" : " to " + g.get("to")),
        "monitor", pid, "OPEN_MONITORING"));
    }
    if (((Number) coverage.get("readings")).intValue() == 0)
      out.add(gap("DATA", "No vital signs recorded this shift", null, "monitor", pid, "OPEN_MONITORING"));
    for (Map<String, Object> a : alerts) {
      if ("FLAGGED".equals(a.get("state")))
        out.add(gap("REVIEW", "Alert not yet reviewed", (String) a.get("title"), "alert", (String) a.get("id"), "ACKNOWLEDGE"));
      else if (Boolean.TRUE.equals(a.get("documentationGap")))
        out.add(gap("DOCUMENTATION", "No follow-up note for alert", (String) a.get("title"), "alert", (String) a.get("id"), "DOCUMENT"));
    }
    if (charts.stream().noneMatch(c -> Set.of("ASSESSMENT", "OBSERVATION").contains(c.type)))
      out.add(gap("DOCUMENTATION", "No assessment documented this shift", null, "chart", pid, "OPEN_PATIENT"));
    if (p.repositionPlan() && (plan == null || plan.lastConfirmedCareAt == null))
      out.add(gap("DOCUMENTATION", "No nurse-confirmed repositioning this shift", null, "movement", pid, "OPEN_REPOSITIONING"));
    long unverified = s.movements.stream().filter(m -> m.patientId.equals(pid) && m.reviewRequired && "UNREVIEWED".equals(m.verificationStatus)).count();
    if (unverified > 0)
      out.add(gap("REVIEW", unverified + " sensor movement" + (unverified == 1 ? "" : "s") + " not verified", null, "movement", pid, "OPEN_REPOSITIONING"));
    long overdue = s.tasks.stream().filter(t -> t.patientId.equals(pid) && WorkflowRules.active(t) && "OVERDUE".equals(t.scheduleState)).count();
    if (overdue > 0)
      out.add(gap("DOCUMENTATION", overdue + " overdue task" + (overdue == 1 ? "" : "s"), null, "task", pid, "OPEN_TASKS"));
    long undocumented = snapshot.stream().filter(f -> f.get("value") == null).count();
    if (undocumented > 0)
      out.add(gap("SNAPSHOT", undocumented + " snapshot fields not documented", null, "snapshot", pid, "FILL_SNAPSHOT"));
    return out;
  }
}
