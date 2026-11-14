package care.achillea;

import static care.achillea.Model.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * A single-process demo aggregate. Commands are synchronized until the repository
 * transaction commits; related task, chart, and audit changes are one atomic row write.
 */
@Service
public class CareService {

  private final StoreRepository repo;
  private final ObjectMapper json;
  private final Clock clock;
  private final DemoSeeder seeder;
  private final MonitorSimulation monitors;
  private final SensorAdapter sensor;

  public CareService(
    StoreRepository repo,
    ObjectMapper json,
    Clock clock,
    DemoSeeder seeder,
    MonitorSimulation monitors
  ) {
    this.repo = repo;
    this.json = json;
    this.clock = clock;
    this.seeder = seeder;
    this.monitors = monitors;
    this.sensor = new SensorAdapter.Simulator(clock);
  }

  private String id() {
    return UUID.randomUUID().toString();
  }

  static void require(boolean condition, String message) {
    if (!condition) throw new ResponseStatusException(
      HttpStatus.CONFLICT,
      message
    );
  }

  static void input(boolean condition, String message) {
    if (!condition) throw new ResponseStatusException(
      HttpStatus.BAD_REQUEST,
      message
    );
  }

  private State load() {
    State s = repo
      .findById("demo")
      .map(row -> {
        try {
          return json.readValue(row.payload, State.class);
        } catch (Exception e) {
          throw new IllegalStateException("Cannot read demo database", e);
        }
      })
      .orElseGet(() -> save(seeder.create(clock.instant())));
    // Upgrade only additive device metadata for legacy snapshots, never reset notes/tasks.
    monitors.ensureDevices(s, clock.instant());
    MonitorSimulation.freshness(s, clock.instant());
    s.serverTime = clock.instant();
    return s;
  }

  private State save(State s) {
    try {
      Store row = repo.findById("demo").orElse(new Store("demo", ""));
      row.payload = json.writeValueAsString(s);
      repo.saveAndFlush(row);
      return s;
    } catch (Exception e) {
      throw new IllegalStateException("Cannot persist demo database", e);
    }
  }

  private State assigned(State s) {
    Set<String> ids = s.patients
      .stream()
      .filter(p -> p.nurseId().equals("nurse-demo"))
      .map(Patient::id)
      .collect(Collectors.toSet());
    s.patients.removeIf(p -> !ids.contains(p.id()));
    s.tasks.removeIf(t -> !ids.contains(t.patientId));
    s.vitals.removeIf(v -> !ids.contains(v.patientId()));
    s.samples.removeIf(x -> !ids.contains(x.patientId()));
    s.movements.removeIf(m -> !ids.contains(m.patientId));
    s.charts.removeIf(c -> !ids.contains(c.patientId));
    s.devices.removeIf(d -> !ids.contains(d.patientId));
    s.events.removeIf(
      e -> e.patientId() != null && !ids.contains(e.patientId())
    );
    s.vitals.sort(
      Comparator.comparing(Vital::observedAt).thenComparing(Vital::id)
    );
    s.movements.sort(Comparator.comparing(m -> m.capturedAt));
    s.events.sort(
      Comparator.comparing(Event::timestamp).thenComparing(Event::id)
    );
    return s;
  }

  public synchronized State read() {
    return assigned(load());
  }

  public synchronized List<Patient> census(String unit) {
    validateUnit(unit);
    return load()
      .patients.stream()
      .filter(p -> p.unit().equals(unit))
      .toList();
  }

  public synchronized Map<String, Object> censusSummary(String unit) {
    State s = load();
    validateUnit(unit);
    Set<String> ids = s.patients
      .stream()
      .filter(p -> p.unit().equals(unit))
      .map(Patient::id)
      .collect(Collectors.toSet());
    return Map.of(
      "unit",
      unit,
      "scope",
      "SYNTHETIC_UNIT_CENSUS",
      "patientCount",
      ids.size(),
      "assignedPatientCount",
      s.patients
        .stream()
        .filter(p -> ids.contains(p.id()) && p.nurseId().equals("nurse-demo"))
        .count(),
      "taskCount",
      s.tasks
        .stream()
        .filter(t -> ids.contains(t.patientId))
        .count(),
      "eventCount",
      s.events
        .stream()
        .filter(e -> ids.contains(e.patientId()))
        .count()
    );
  }

  void event(
    State s,
    String patient,
    String type,
    String source,
    String details
  ) {
    s.events.add(
      new Event(id(), patient, type, source, details, clock.instant())
    );
  }

  public synchronized State reset() {
    State s = seeder.create(clock.instant());
    s.serverTime = clock.instant();
    MonitorSimulation.freshness(s, clock.instant());
    return assigned(save(s));
  }

  public synchronized State monitorTick() {
    State s = load();
    monitors.tick(s, clock.instant());
    MonitorSimulation.freshness(s, clock.instant());
    save(s);
    return assigned(s);
  }

  public Patient patient(State s, String id) {
    return s.patients
      .stream()
      .filter(p -> p.id().equals(id) && p.nurseId().equals("nurse-demo"))
      .findFirst()
      .orElseThrow(() ->
        new ResponseStatusException(
          HttpStatus.NOT_FOUND,
          "Assigned patient not found"
        )
      );
  }

  static void validateUnit(String unit) {
    input(
      Set.of("L_AND_D", "ICU").contains(Objects.toString(unit, "")),
      "Unsupported demo unit"
    );
  }

  Task task(State s, String id) {
    Task t = s.tasks
      .stream()
      .filter(x -> x.id.equals(id))
      .findFirst()
      .orElseThrow(() ->
        new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found")
      );
    patient(s, t.patientId);
    return t;
  }

  Chart chart(State s, String id) {
    Chart c = s.charts
      .stream()
      .filter(x -> x.id.equals(id))
      .findFirst()
      .orElseThrow(() ->
        new ResponseStatusException(HttpStatus.NOT_FOUND, "Chart not found")
      );
    patient(s, c.patientId);
    return c;
  }

  Movement movement(State s, String id) {
    Movement m = s.movements
      .stream()
      .filter(x -> x.id.equals(id))
      .findFirst()
      .orElseThrow(() ->
        new ResponseStatusException(HttpStatus.NOT_FOUND, "Movement not found")
      );
    patient(s, m.patientId);
    return m;
  }

  public synchronized Vital ingest(Observation in) {
    input(
      in.sourceEventId() != null &&
        !in.sourceEventId().isBlank() &&
        in.sourceEventId().length() <= 160 &&
        in.observedAt() != null &&
        !in.observedAt().isAfter(clock.instant().plusSeconds(60)) &&
        Double.isFinite(in.value()),
      "Valid source event ID, value, and observation timestamp required"
    );
    String expected = switch (Objects.toString(in.metric(), "")) {
      case "HEART_RATE" -> "bpm";
      case "SPO2" -> "%";
      case "TEMPERATURE" -> "°C";
      case "RESPIRATORY_RATE" -> "breaths/min";
      default -> throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Unsupported metric"
      );
    };
    input(
      expected.equals(in.unit()) &&
        Set.of("VALID", "SUSPECTED_ARTIFACT", "MISSING", "UNKNOWN").contains(
          Objects.toString(in.quality(), "")
        ),
      "Metric unit or quality invalid"
    );
    State s = load();
    patient(s, in.patientId());
    Optional<Vital> previous = s.vitals
      .stream()
      .filter(v -> v.sourceEventId().equals(in.sourceEventId()))
      .findFirst();
    if (previous.isPresent()) {
      Vital v = previous.get();
      require(
        v.patientId().equals(in.patientId()) &&
          v.metric().equals(in.metric()) &&
          v.value() == in.value() &&
          v.observedAt().equals(in.observedAt()) &&
          v.quality().equals(in.quality()),
        "Source event ID was already used for different data"
      );
      return v;
    }
    Vital v = new Vital(
      id(),
      in.patientId(),
      in.metric(),
      in.value(),
      in.unit(),
      in.observedAt(),
      clock.instant(),
      "SIMULATED_MONITOR",
      in.sourceEventId(),
      in.quality()
    );
    s.vitals.add(v);
    Device d = monitors.monitor(s, in.patientId());
    d.lastSeenAt = clock.instant();
    if (
      d.lastSampledAt == null || in.observedAt().isAfter(d.lastSampledAt)
    ) d.lastSampledAt = in.observedAt();
    event(
      s,
      v.patientId(),
      "vital.received",
      "SIMULATED_MONITOR",
      "Observation ingested from " + d.id
    );
    save(s);
    return v;
  }

  public List<Round> rounds(State s, String unit) {
    validateUnit(unit);
    Instant now = clock.instant();
    return s.tasks
      .stream()
      .filter(t -> !Set.of("COMPLETED", "CANCELLED").contains(t.status))
      .filter(t ->
        s.patients
          .stream()
          .anyMatch(
            p ->
              p.id().equals(t.patientId) &&
              p.nurseId().equals("nurse-demo") &&
              p.unit().equals(unit)
          )
      )
      .map(t -> {
        int rank = t.priority.equals("HIGH")
          ? 0
          : !t.dueAt.isAfter(now)
            ? 1
            : !t.dueAt.isAfter(now.plusSeconds(1800))
              ? 2
              : 3;
        String reason =
          rank == 0
            ? "Explicit high priority (configured demo rule)"
            : rank == 1
              ? "Past scheduled due time"
              : rank == 2
                ? "Due within 30 minutes"
                : "Routine · nurse-selected sequence";
        if (
          s.devices
            .stream()
            .anyMatch(
              d ->
                d.patientId.equals(t.patientId) &&
                !d.connectionState.equals("CONNECTED")
            )
        ) reason +=
          " · device connection awaiting review; no clinical urgency inferred";
        if (t.status.equals("DEFERRED")) reason +=
          " · deferred by nurse: " + t.deferReason;
        return new Round(t, reason, rank);
      })
      .sorted(
        Comparator.comparingInt(Round::rank)
          .thenComparingInt(r -> r.rank() == 3 ? r.task().order : 0)
          .thenComparing(r -> r.task().dueAt)
          .thenComparing(r -> r.task().id)
      )
      .toList();
  }

  public synchronized Chart draft(Draft d, String existing, String amendment) {
    State s = load();
    patient(s, d.patientId());
    input(
      d.text() != null && !d.text().isBlank() && d.text().length() <= 5000,
      "Observation required (maximum 5000 characters)"
    );
    input(
      Set.of(
        "OBSERVATION",
        "ASSESSMENT",
        "CARE_NOTE",
        "TASK_COMPLETION"
      ).contains(Objects.toString(d.type(), "OBSERVATION")),
      "Unsupported chart type"
    );
    Chart c = existing == null ? new Chart() : chart(s, existing);
    require(
      c.status.equals("DRAFT"),
      "Confirmed entries are immutable; append an amendment"
    );
    if (existing != null) require(
      c.patientId.equals(d.patientId()),
      "Patient cannot change"
    );
    if (d.linkedTaskId() != null) require(
      task(s, d.linkedTaskId()).patientId.equals(d.patientId()),
      "Task belongs to another patient"
    );
    List<String> links =
      d.linkedVitalIds() == null ? List.of() : d.linkedVitalIds();
    input(links.size() <= 100, "Too many linked observations");
    for (String v : links)
      require(
        s.vitals
          .stream()
          .anyMatch(
            x -> x.id().equals(v) && x.patientId().equals(d.patientId())
          ),
        "Invalid linked observation"
      );
    if (d.linkedMovementId() != null) require(
      movement(s, d.linkedMovementId()).patientId.equals(d.patientId()),
      "Movement belongs to another patient"
    );
    if (amendment != null) {
      Chart original = chart(s, amendment);
      require(
        !original.status.equals("DRAFT") &&
          original.patientId.equals(d.patientId()),
        "Only confirmed entries for this patient can be amended"
      );
    }
    c.patientId = d.patientId();
    c.type = d.type() == null ? "OBSERVATION" : d.type();
    c.text = d.text();
    c.linkedTaskId = d.linkedTaskId();
    c.linkedVitalIds = new ArrayList<>(links);
    c.linkedMovementId = d.linkedMovementId();
    // Editing an amendment draft must preserve its immutable link to the original entry.
    if (existing == null) c.amendmentOfId = amendment;
    c.provenance = links.isEmpty()
      ? "MANUAL_ENTRY"
      : "MANUAL_ENTRY + SIMULATED_MONITOR (linked immutable observations)";
    if (d.linkedMovementId() != null) c.provenance +=
      " + SIMULATED_SENSOR (observation, not verified care)";
    if (existing == null) {
      c.id = id();
      c.authoredAt = clock.instant();
      s.charts.add(c);
    }
    event(
      s,
      c.patientId,
      existing == null ? "chart.created" : "chart.updated",
      "nurse-demo",
      "Draft saved"
    );
    // Keep the original chart.draft event for prefix/exact consumers.
    event(s, c.patientId, "chart.draft", "nurse-demo", "Draft saved");
    save(s);
    return c;
  }

  public synchronized State confirm(String id, Command cmd) {
    State s = load();
    Chart c = chart(s, id);
    require(c.status.equals("DRAFT"), "Entry already confirmed");
    require(
      Boolean.TRUE.equals(cmd.verified()),
      "Review and verify the entry first"
    );
    c.status = c.amendmentOfId == null ? "CONFIRMED" : "AMENDED";
    c.confirmedAt = clock.instant();
    event(
      s,
      c.patientId,
      "chart.confirmed",
      "nurse-demo",
      "Entry confirmed with provenance: " + c.provenance
    );
    if (c.amendmentOfId != null) event(
      s,
      c.patientId,
      "chart.amended",
      "nurse-demo",
      "Append-only correction to entry " + c.amendmentOfId
    );
    save(s);
    return assigned(s);
  }

  public synchronized State taskCommand(String id, String action, Command c) {
    State s = load();
    Task t = task(s, id);
    require(
      !Set.of("COMPLETED", "CANCELLED").contains(t.status),
      "Terminal task cannot change"
    );
    switch (action) {
      case "acknowledge" -> {
        require(
          Set.of("OPEN", "DEFERRED", "ACKNOWLEDGED").contains(t.status),
          "Task cannot be acknowledged"
        );
        t.status = "ACKNOWLEDGED";
      }
      case "defer" -> {
        input(
          c.reason() != null &&
            !c.reason().isBlank() &&
            c.reason().length() <= 1000,
          "Deferral reason required (maximum 1000 characters)"
        );
        t.status = "DEFERRED";
        t.deferReason = c.reason();
        t.dueAt = clock.instant().plusSeconds(1800);
      }
      case "reorder" -> {
        require(
          t.priority.equals("ROUTINE") &&
            t.dueAt.isAfter(clock.instant().plusSeconds(1800)),
          "Only routine future tasks may move"
        );
        input(c.order() != null, "Order is required");
        t.order = c.order();
      }
      case "priority" -> {
        input(
          Set.of("ROUTINE", "TIMELY", "HIGH").contains(
            Objects.toString(c.priority(), "")
          ),
          "Invalid priority"
        );
        t.priority = c.priority();
      }
      case "complete" -> {
        require(
          Boolean.TRUE.equals(c.verified()),
          "Nurse verification is required"
        );
        Movement m =
          c.movementId() == null ? null : movement(s, c.movementId());
        if (m != null) require(
          m.patientId.equals(t.patientId),
          "Movement belongs to another patient"
        );
        if (t.verificationRequired) {
          require(
            m != null && m.verificationStatus.equals("CONFIRMED_CARE"),
            "Movement must be nurse-confirmed care for this patient"
          );
          require(
            s.tasks
              .stream()
              .noneMatch(
                x ->
                  x.status.equals("COMPLETED") &&
                  s.charts
                    .stream()
                    .anyMatch(
                      note ->
                        x.id.equals(note.linkedTaskId) &&
                        m.id.equals(note.linkedMovementId)
                    )
              ),
            "Movement was already used for completed care"
          );
        }
        input(
          c.text() == null ||
            (!c.text().isBlank() && c.text().length() <= 5000),
          "Completion note invalid"
        );
        t.status = "COMPLETED";
        t.completedAt = clock.instant().toString();
        t.verifiedBy = "nurse-demo";
        Chart note = new Chart();
        note.id = id();
        note.patientId = t.patientId;
        note.type = "TASK_COMPLETION";
        note.text =
          c.text() == null ? t.title + " — verified by demo nurse" : c.text();
        note.status = "CONFIRMED";
        note.authoredAt = note.confirmedAt = clock.instant();
        note.linkedTaskId = t.id;
        note.linkedMovementId = c.movementId();
        note.provenance = "NURSE_VERIFIED_CARE";
        s.charts.add(note);
        event(
          s,
          t.patientId,
          "chart.confirmed",
          "nurse-demo",
          "Verified task completion recorded"
        );
      }
      default -> throw new ResponseStatusException(
        HttpStatus.BAD_REQUEST,
        "Unknown task action"
      );
    }
    event(
      s,
      t.patientId,
      "task." + action,
      "nurse-demo",
      t.title + (c.reason() == null ? "" : " · " + c.reason())
    );
    save(s);
    return assigned(s);
  }

  public synchronized State review(String id, Command c) {
    State s = load();
    Movement m = movement(s, id);
    input(
      Set.of("CONFIRMED_CARE", "NOT_CARE", "NEEDS_REVIEW").contains(
        Objects.toString(c.status(), "")
      ),
      "Invalid review status"
    );
    require(
      !m.verificationStatus.equals("CONFIRMED_CARE"),
      "Care already confirmed"
    );
    input(
      c.text() == null || c.text().length() <= 5000,
      "Review note too long"
    );
    if (c.status().equals("CONFIRMED_CARE")) require(
      Boolean.TRUE.equals(c.verified()) &&
        c.text() != null &&
        !c.text().isBlank(),
      "Verification and bedside observation required"
    );
    m.verificationStatus = c.status();
    m.reviewerId = "nurse-demo";
    m.reviewedAt = clock.instant().toString();
    event(
      s,
      m.patientId,
      "movement.reviewed",
      "nurse-demo",
      c.status() + " · " + Objects.toString(c.text(), "")
    );
    save(s);
    return assigned(s);
  }

  public synchronized State scenario(String key, String patientId) {
    State s = load();
    if (key.equals("monitor-tick")) {
      monitors.tick(s, clock.instant());
      event(s, null, "demo.trigger", "SIMULATOR", key);
      MonitorSimulation.freshness(s, clock.instant());
      save(s);
      return assigned(s);
    }
    if (
      Set.of(
        "vital",
        "flagged",
        "monitor-disconnect",
        "monitor-delay",
        "monitor-reconnect"
      ).contains(key)
    ) {
      String pid = patientId == null ? "synthetic-ld-01" : patientId;
      patient(s, pid);
      Device d = monitors.monitor(s, pid);
      if (key.startsWith("monitor-")) {
        d.manualOverride = true;
        monitors.transition(
          s,
          d,
          key.equals("monitor-disconnect")
            ? "DISCONNECTED"
            : key.equals("monitor-delay")
              ? "DELAYED"
              : "CONNECTED",
          clock.instant()
        );
        if (key.equals("monitor-reconnect")) addManualVital(s, pid, false, d);
      } else {
        require(
          !d.connectionState.equals("DISCONNECTED"),
          "Monitor disconnected; reconnect before generating a reading"
        );
        addManualVital(s, pid, key.equals("flagged"), d);
      }
    } else {
      input(
        Set.of(
          "partial",
          "coordinated",
          "minor",
          "disconnect",
          "reconnect",
          "no-movement"
        ).contains(key),
        "Unknown scenario"
      );
      String pid = patientId == null ? "synthetic-icu-01" : patientId;
      Patient p = patient(s, pid);
      // Legacy UI sends the selected L&D patient for global sensor controls; preserve the original ICU target.
      if (!p.repositionPlan()) pid = "synthetic-icu-01";
      patient(s, pid);
      String target = pid;
      Movement prev = s.movements
        .stream()
        .filter(x -> x.patientId.equals(target))
        .max(Comparator.comparing(x -> x.capturedAt))
        .orElse(null);
      Device pelvis = s.devices
        .stream()
        .filter(
          d -> d.patientId.equals(target) && d.bodyRegion.equals("PELVIS")
        )
        .findFirst()
        .orElseThrow();
      Device chest = s.devices
        .stream()
        .filter(
          d -> d.patientId.equals(target) && d.bodyRegion.equals("UPPER_TORSO")
        )
        .findFirst()
        .orElseThrow();
      if (
        key.equals("disconnect") || key.equals("reconnect")
      ) monitors.transition(
        s,
        pelvis,
        key.equals("disconnect") ? "DISCONNECTED" : "CONNECTED",
        clock.instant()
      );
      Movement m = sensor.sample(key, prev);
      m.patientId = target;
      m.chestSensorId = chest.id;
      m.pelvisSensorId = pelvis.id;
      if (pelvis.connectionState.equals("DISCONNECTED")) {
        m.quality = "PELVIS_DISCONNECTED";
        m.classification = "UNKNOWN";
        m.confidence = null;
        m.sampleIds = List.of(m.id + "-chest");
        m.pelvisAfter = m.pelvisBefore;
      }
      s.movements.add(m);
      s.samples.add(
        new OrientationSample(
          m.id + "-chest",
          chest.id,
          target,
          "UPPER_TORSO",
          m.chestAfter,
          m.capturedAt,
          clock.instant(),
          "SIMULATED_GOOD",
          "SIMULATED"
        )
      );
      chest.lastSeenAt = chest.lastSampledAt = clock.instant();
      if (!m.quality.equals("PELVIS_DISCONNECTED")) {
        s.samples.add(
          new OrientationSample(
            m.id + "-pelvis",
            pelvis.id,
            target,
            "PELVIS",
            m.pelvisAfter,
            m.capturedAt,
            clock.instant(),
            "SIMULATED_GOOD",
            "SIMULATED"
          )
        );
        pelvis.lastSeenAt = pelvis.lastSampledAt = clock.instant();
      }
      event(
        s,
        target,
        "movement.candidate",
        "SIMULATED_SENSOR",
        m.classification + " · " + m.quality + " · prototype heuristic"
      );
      event(
        s,
        target,
        "movement.detected",
        "SIMULATED_SENSOR",
        "Independent region observations; awaiting nurse review"
      );
      if (key.equals("no-movement")) for (Task t : s.tasks)
        if (
          t.patientId.equals(target) &&
          t.type.equals("REPOSITION_REVIEW") &&
          !t.status.equals("COMPLETED")
        ) {
          t.dueAt = clock.instant().minusSeconds(1);
          event(
            s,
            target,
            "task.updated",
            "SIMULATOR",
            "Prescribed review made due; no care inferred"
          );
        }
    }
    event(s, null, "demo.trigger", "SIMULATOR", key);
    MonitorSimulation.freshness(s, clock.instant());
    save(s);
    return assigned(s);
  }

  private void addManualVital(State s, String pid, boolean flagged, Device d) {
    Instant now = clock.instant();
    Instant sampled = d.connectionState.equals("DELAYED")
      ? now.minusSeconds(90)
      : now;
    long count = s.vitals
      .stream()
      .filter(v -> v.patientId().equals(pid))
      .count();
    s.vitals.add(
      new Vital(
        id(),
        pid,
        "HEART_RATE",
        flagged ? 124 : 78 + (count % 7),
        "bpm",
        sampled,
        now,
        "SIMULATED_MONITOR",
        id(),
        flagged
          ? "REVIEW_REQUESTED_DEMO_RULE"
          : d.connectionState.equals("DELAYED")
            ? "DELAYED"
            : "VALID",
        d.id
      )
    );
    d.lastSeenAt = now;
    d.lastSampledAt = sampled;
    event(
      s,
      pid,
      "vital.received",
      "SIMULATED_MONITOR",
      "New synthetic heart-rate observation from " + d.id
    );
    if (
      flagged &&
      s.tasks
        .stream()
        .noneMatch(
          t ->
            t.patientId.equals(pid) &&
            t.type.equals("VITAL_REVIEW") &&
            !t.status.equals("COMPLETED")
        )
    ) {
      Task t = new Task(
        id(),
        pid,
        "Review latest synthetic reading",
        "VITAL_REVIEW",
        now,
        false,
        0
      );
      t.priority = "HIGH";
      t.source = "SIMULATED_MONITOR_DEMO_RULE";
      s.tasks.add(t);
      event(
        s,
        pid,
        "task.created",
        t.source,
        "Review request from configured synthetic scenario, not clinical triage"
      );
    }
  }
}
