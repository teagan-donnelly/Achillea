package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;

/**
 * Deterministic, demonstration-only trend rules over replayed readings. Not a diagnosis and no
 * treatment is suggested. A rule fires only on a sustained change (three consecutive readings past
 * a threshold relative to the first three readings of the current replay loop) and at most once per
 * patient and rule while an earlier alert is still unresolved.
 */
final class MonitorAnalysis {

  private MonitorAnalysis() {}

  static final String TYPE = "MONITORING_ALERT";
  /** Demonstration thresholds; not validated clinical values. */
  static final double HR_RISE_BPM = 15, SPO2_DROP_POINTS = 4, SPO2_FLOOR = 94;
  static final int SUSTAINED = 3;

  static void analyze(State s, String patientId, String session, int loop, String kind, Instant now) {
    rule(s, patientId, session, loop, kind, now, "HEART_RATE", "HR_SUSTAINED_RISE", true, HR_RISE_BPM);
    rule(s, patientId, session, loop, kind, now, "SPO2", "SPO2_SUSTAINED_DROP", false, SPO2_DROP_POINTS);
  }

  private static void rule(
    State s, String pid, String session, int loop, String kind, Instant now,
    String metric, String rule, boolean rising, double delta
  ) {
    String prefix = ReplayEngine.PREFIX + session + ":L" + loop + ":" + pid + ":";
    List<Vital> series = s.vitals.stream()
      .filter(v -> v.metric().equals(metric) && v.sourceEventId() != null && v.sourceEventId().startsWith(prefix))
      .sorted(Comparator.comparing(v -> ReplayEngine.recordedMinute(v.sourceEventId())))
      .toList();
    if (series.size() < SUSTAINED * 2) return;
    double[] base = series.subList(0, SUSTAINED).stream().mapToDouble(Vital::value).sorted().toArray();
    double baseline = base[SUSTAINED / 2];
    double threshold = rising ? baseline + delta : Math.min(baseline - delta, SPO2_FLOOR);
    List<Vital> recent = series.subList(series.size() - SUSTAINED, series.size());
    boolean sustained = recent.stream().allMatch(v -> rising ? v.value() >= threshold : v.value() <= threshold);
    if (!sustained) return;
    boolean open = s.tasks.stream().anyMatch(t ->
      TYPE.equals(t.type) && pid.equals(t.patientId) && WorkflowRules.active(t) && t.id.contains(":" + rule + ":"));
    if (open) return;
    String id = "alert:" + rule + ":" + pid + ":" + session + ":L" + loop;
    if (s.tasks.stream().anyMatch(t -> t.id.equals(id))) return; // resolved earlier in this loop
    String name = metric.equals("HEART_RATE") ? "Heart rate" : "SpO2";
    String unit = ReplayEngine.unit(metric);
    Task t = new Task(id, pid,
      name + (rising ? " sustained rise" : " sustained decrease") + " — review at bedside",
      TYPE, now, false, 0);
    t.priority = "TIMELY";
    t.source = "MONITORING_TREND_RULE";
    s.tasks.add(t);
    StringJoiner values = new StringJoiner(", ");
    StringJoiner minutes = new StringJoiner(", ");
    StringJoiner ids = new StringJoiner(",");
    for (Vital v : recent) {
      values.add(fmt(v.value()));
      minutes.add(String.valueOf(ReplayEngine.recordedMinute(v.sourceEventId())));
      ids.add(v.id());
    }
    String details = name + " " + (rising ? "rose" : "fell") + " from a baseline of " + fmt(baseline) + " " + unit +
      " to " + values + " " + unit + " across " + SUSTAINED + " consecutive readings (demo rule: " +
      (rising ? "≥" : "≤") + fmt(threshold) + " " + unit + "). Recorded shift minutes " + minutes +
      "; replay session " + session + ", loop " + loop + "; source " + kind +
      ". Demonstration threshold, not a diagnosis. evidence=" + ids;
    s.events.add(new Event("evidence:" + id, pid, "monitoring.alert", kind, details, now));
  }

  private static String fmt(double v) {
    return v == Math.rint(v) ? String.valueOf((long) v) : String.valueOf(v);
  }
}
