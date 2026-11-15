package care.achillea;

import static care.achillea.Model.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.time.Instant;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Backend-managed replay of recorded vital signs (resources/replay/recordings.json).
 *
 * <p>One shared replay clock for every patient, advanced by a single scheduled thread, so playback
 * never depends on a browser tab being visible. Values are copied verbatim from the recordings;
 * gaps stay gaps. Each stored reading's sourceEventId records the replay session, loop, patient,
 * original recorded minute and metric, so recorded time and replay time are never confused and a
 * reading is never written twice.
 */
@Component
public class ReplayEngine {

  private static final Logger log = LoggerFactory.getLogger(ReplayEngine.class);
  public static final String PREFIX = "replay:";
  static final Set<Integer> SPEEDS = Set.of(1, 5, 10);

  record Reading(int minute, String label, double value) {}

  record Recording(
    String patientId,
    String kind,
    String stay,
    String source,
    String unit,
    List<Reading> readings
  ) {}

  private final CareService care;
  private final MonitorSimulation monitors;
  private final List<Recording> recordings;
  private final int first, last;
  private final boolean enabled, autostart;

  private int speed;
  private boolean loop, paused, ended;
  private double cursor;
  private int loopIndex;
  private String sessionId;
  private Instant sessionStartedAt;
  private long lastNanos;
  private int readingsWritten;
  private final Map<String, Integer> lastMinute = new HashMap<>();

  public ReplayEngine(
    CareService care,
    MonitorSimulation monitors,
    ObjectMapper json,
    @Value("${app.replay.enabled:false}") boolean enabled,
    @Value("${app.replay.speed:10}") int speed,
    @Value("${app.replay.loop:true}") boolean loop,
    @Value("${app.replay.autostart:true}") boolean autostart
  ) {
    this.autostart = autostart;
    this.care = care;
    this.monitors = monitors;
    this.enabled = enabled;
    this.speed = SPEEDS.contains(speed) ? speed : 10;
    this.loop = loop;
    this.recordings = load(json);
    this.first = recordings.stream().flatMap(r -> r.readings().stream()).mapToInt(Reading::minute).min().orElse(0);
    this.last = recordings.stream().flatMap(r -> r.readings().stream()).mapToInt(Reading::minute).max().orElse(0);
  }

  private static List<Recording> load(ObjectMapper json) {
    try (InputStream in = ReplayEngine.class.getResourceAsStream("/replay/recordings.json")) {
      if (in == null) return List.of();
      List<Recording> out = new ArrayList<>();
      for (JsonNode r : json.readTree(in).path("recordings")) {
        List<Reading> readings = new ArrayList<>();
        for (JsonNode e : r.path("events")) readings.add(new Reading(e.get(0).asInt(), e.get(1).asText(), e.get(2).asDouble()));
        readings.sort(Comparator.comparingInt(Reading::minute));
        out.add(new Recording(
          r.path("patientId").asText(),
          r.path("kind").asText(),
          r.path("stay").isNull() ? null : r.path("stay").asText(),
          r.path("source").asText(),
          r.path("unit").asText(),
          List.copyOf(readings)
        ));
      }
      return List.copyOf(out);
    } catch (IOException e) {
      throw new IllegalStateException("Cannot read replay recordings", e);
    }
  }

  // ------------------------------------------------------------------ clock

  /** Checks every 100 ms so each reading is stored the moment it is due (writes only when one is). */
  @Scheduled(fixedDelay = 100, initialDelay = 1500)
  void scheduled() {
    if (!enabled || !autostart) return;
    try {
      long now = System.nanoTime();
      double elapsed = lastNanos == 0 ? 0 : (now - lastNanos) / 1e9;
      lastNanos = now;
      advance(Math.min(elapsed, 5));
    } catch (RuntimeException e) {
      log.error("Replay tick failed ({}: {}); retrying", e.getClass().getSimpleName(), e.getMessage());
    }
  }

  /** Advances the shared clock by real seconds and writes every reading that became due. */
  synchronized void advance(double realSeconds) {
    if (sessionId == null) startSession();
    if (paused || ended) return;
    double next = cursor + realSeconds * speed;
    List<Due> due = new ArrayList<>();
    double carry = Math.max(0, next - last);
    collect(cursor, Math.min(next, last), loopIndex, carry, due);
    if (next > last) {
      if (loop) {
        loopIndex++;
        cursor = first - 1;
        next = cursor + carry;
        collect(cursor, next, loopIndex, next - (first - 1) - carry, due);
      } else {
        ended = true;
        next = last;
      }
    }
    cursor = next;
    if (!due.isEmpty()) write(due);
  }

  /** lag: recorded minutes between this reading's due time and the end of the tick. */
  private record Due(Recording recording, Reading reading, int loop, double lag) {}

  private void collect(double from, double to, int loopNo, double extraLag, List<Due> out) {
    for (Recording r : recordings)
      for (Reading x : r.readings())
        if (x.minute() > from && x.minute() <= to) out.add(new Due(r, x, loopNo, to - x.minute() + extraLag));
  }

  private void startSession() {
    sessionId = "R" + Long.toString(System.currentTimeMillis(), 36).toUpperCase(Locale.ROOT);
    sessionStartedAt = care.now();
    cursor = first - 1;
    loopIndex = 0;
    ended = false;
    lastMinute.clear();
    care.mutate(s -> {
      for (Recording r : recordings) {
        if (s.patients.stream().noneMatch(p -> p.id().equals(r.patientId()))) continue;
        monitors.replayOwned.add(r.patientId());
        Device d = monitors.monitor(s, r.patientId());
        d.manualOverride = false;
        d.mode = r.kind();
        d.updateIntervalSeconds = interval();
        monitors.transition(s, d, "CONNECTED", care.now());
      }
      MonitorSimulation.audit(s, null, "replay.started",
        "Recorded data replay session " + sessionId + " started at " + speed + "x", care.now());
      return null;
    });
    log.info("Recorded data replay {} started: {} recordings, minutes {}..{}", sessionId, recordings.size(), first, last);
  }

  private int interval() {
    return Math.max(5, (int) Math.ceil(60.0 / speed));
  }

  private void write(List<Due> due) {
    Instant now = care.now();
    care.mutate(s -> {
      Set<String> touched = new LinkedHashSet<>();
      Set<String> existing = new HashSet<>();
      for (Vital v : s.vitals) if (v.sourceEventId() != null && v.sourceEventId().startsWith(PREFIX + sessionId)) existing.add(v.sourceEventId());
      for (Due d : due) {
        String pid = d.recording().patientId();
        if (s.patients.stream().noneMatch(p -> p.id().equals(pid))) continue;
        String metric = metric(d.reading().label());
        if (metric == null) continue;
        String eventId = PREFIX + sessionId + ":L" + d.loop() + ":" + pid + ":" + d.reading().minute() + ":" + metric;
        if (!existing.add(eventId)) continue;
        double value = d.reading().label().equals("TempF")
          ? Math.round((d.reading().value() - 32) * 5 / 9 * 10) / 10.0
          : d.reading().value();
        String id = UUID.randomUUID().toString();
        // Replay time at which this reading became due (keeps order inside one batch).
        Instant observed = now.minusMillis(Math.round(d.lag() * 1000 / speed));
        s.vitals.add(new Vital(id, pid, metric, value, unit(metric), observed, now, d.recording().kind(), eventId, "VALID", "monitor-" + pid));
        touched.add(pid);
        lastMinute.put(pid, d.reading().minute());
        readingsWritten++;
      }
      for (String pid : touched) {
        monitors.replayOwned.add(pid);
        Device d = monitors.monitor(s, pid);
        d.connectionState = "CONNECTED";
        d.manualOverride = false;
        d.mode = recording(pid).map(Recording::kind).orElse(d.mode);
        d.updateIntervalSeconds = interval();
        d.lastSeenAt = now;
        d.lastSampledAt = now;
        MonitorAnalysis.analyze(s, pid, sessionId, loopIndex, recording(pid).map(Recording::kind).orElse("REPLAY"), now);
      }
      MonitorSimulation.freshness(s, now);
      WorkflowRules.apply(s, now);
      return null;
    });
  }

  static String metric(String label) {
    return switch (label) {
      case "HR" -> "HEART_RATE";
      case "SpO2" -> "SPO2";
      case "RR" -> "RESPIRATORY_RATE";
      case "TempF" -> "TEMPERATURE";
      case "SBP" -> "BLOOD_PRESSURE_SYSTOLIC";
      case "DBP" -> "BLOOD_PRESSURE_DIASTOLIC";
      default -> null;
    };
  }

  static String unit(String metric) {
    return switch (metric) {
      case "HEART_RATE" -> "bpm";
      case "SPO2" -> "%";
      case "RESPIRATORY_RATE" -> "breaths/min";
      case "TEMPERATURE" -> "°C";
      default -> "mmHg";
    };
  }

  /** The original recorded minute (relative to shift start) of a replayed reading, else null. */
  static Integer recordedMinute(String sourceEventId) {
    if (sourceEventId == null || !sourceEventId.startsWith(PREFIX)) return null;
    String[] parts = sourceEventId.split(":");
    try {
      return parts.length >= 5 ? Integer.parseInt(parts[4]) : null;
    } catch (NumberFormatException e) {
      return null;
    }
  }

  Optional<Recording> recording(String patientId) {
    return recordings.stream().filter(r -> r.patientId().equals(patientId)).findFirst();
  }

  // ------------------------------------------------------------------ controls

  public synchronized Map<String, Object> control(String action, Integer requestedSpeed, Boolean requestedLoop) {
    CareService.require(enabled, "Recorded data replay is disabled on this backend (app.replay.enabled=false)");
    switch (action) {
      case "pause" -> paused = true;
      case "resume" -> {
        paused = false;
        if (ended) ended = false;
      }
      case "restart" -> {
        sessionId = null;
        paused = false;
        lastNanos = System.nanoTime();
        startSession();
      }
      case "speed" -> {
        CareService.input(requestedSpeed != null && SPEEDS.contains(requestedSpeed), "speed must be 1, 5 or 10");
        speed = requestedSpeed;
      }
      case "loop" -> {
        CareService.input(requestedLoop != null, "loop must be true or false");
        loop = requestedLoop;
      }
      default -> CareService.input(false, "Unknown replay action");
    }
    return status();
  }

  public synchronized Map<String, Object> status() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("enabled", enabled);
    m.put("label", "Recorded Data Replay");
    m.put("sessionId", sessionId);
    m.put("sessionStartedAt", sessionStartedAt);
    m.put("state", !enabled ? "DISABLED" : ended ? "ENDED" : paused ? "PAUSED" : sessionId == null ? "STARTING" : "PLAYING");
    m.put("speed", speed);
    m.put("speeds", List.of(1, 5, 10));
    m.put("speedMeaning", "recorded minutes per real second");
    m.put("loop", loop);
    m.put("loopIndex", loopIndex);
    m.put("recordedMinute", Math.round(cursor));
    m.put("firstMinute", first);
    m.put("lastMinute", last);
    m.put("readingsWritten", readingsWritten);
    List<Map<String, Object>> patients = new ArrayList<>();
    for (Recording r : recordings) {
      Map<String, Object> p = new LinkedHashMap<>();
      p.put("patientId", r.patientId());
      p.put("kind", r.kind());
      p.put("stay", r.stay());
      p.put("source", r.source());
      p.put("readings", r.readings().size());
      p.put("lastRecordedMinute", lastMinute.get(r.patientId()));
      patients.add(p);
    }
    m.put("patients", patients);
    return m;
  }
}
