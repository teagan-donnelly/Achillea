package care.achillea;

import static care.achillea.Model.*;

import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * A single-process demo aggregate. Commands are synchronized until the repository
 * transaction commits; related task, chart, and audit changes are written to their
 * relational tables in one transaction (see RelationalStore).
 */
@Service
public class CareService {

  private final RelationalStore store;
  private final Clock clock;
  private final DemoSeeder seeder;
  private final MonitorSimulation monitors;
  private final SensorAdapter sensor;

  public CareService(
    RelationalStore store,
    Clock clock,
    DemoSeeder seeder,
    MonitorSimulation monitors
  ) {
    this.store = store;
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
    State s = store
      .load()
      .orElseGet(() -> save(seeder.create(clock.instant())));
    // Upgrade only additive device metadata for legacy snapshots, never reset notes/tasks.
    monitors.ensureDevices(s, clock.instant());
    Repositioning.initialize(s, clock.instant());
    MonitorSimulation.freshness(s, clock.instant());
    s.movements.forEach(WorkflowRules::classify);
    s.serverTime = clock.instant();
    return s;
  }

  private State save(State s) {
    Repositioning.initialize(s, clock.instant());
    try {
      store.save(s);
      return s;
    } catch (RuntimeException e) {
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
    s.repositioningPlans.removeIf(p -> !ids.contains(p.patientId));
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

  public synchronized List<Repositioning.Status> repositioning(String unit) {
    validateUnit(unit);
    return Repositioning.queue(read(), clock.instant(), unit);
  }

  /** One persisted aggregate write: explicit bedside verification, chart, plan, tasks and audit. */
  public synchronized State confirmTurn(String patientId, Command c) {
    State s = load();
    Patient p = patient(s, patientId);
    require(p.repositionPlan(), "No active repositioning plan");
    input(
      Boolean.TRUE.equals(c.verified()) &&
        c.text() != null &&
        !c.text().isBlank() &&
        c.text().length() <= 5000,
      "Bedside verification and a care observation are required"
    );
    input(c.movementId() != null, "Select the movement being reviewed");
    Movement m = movement(s, c.movementId());
    require(
      m.patientId.equals(patientId),
      "Movement belongs to another patient"
    );
    require(
      !"CONFIRMED_CARE".equals(m.verificationStatus),
      "Care already confirmed"
    );
    Repositioning.Plan plan = s.repositioningPlans
      .stream()
      .filter(x -> x.patientId.equals(patientId))
      .findFirst()
      .orElseThrow();
    require(
      plan.lastConfirmedCareAt == null ||
        !m.capturedAt.isBefore(plan.lastConfirmedCareAt),
      "Evidence predates the latest confirmed care"
    );
    m.verificationStatus = "CONFIRMED_CARE";
    m.reviewerId = "nurse-demo";
    m.reviewedAt = clock.instant().toString();
    Chart chart = new Chart();
    chart.id = id();
    chart.patientId = patientId;
    chart.type = "CARE_NOTE";
    chart.text = c.text();
    chart.status = "CONFIRMED";
    chart.authoredAt = clock.instant();
    chart.confirmedAt = clock.instant();
    chart.linkedMovementId = m.id;
    chart.provenance =
      "EXPLICIT_BEDSIDE_VERIFICATION + SIMULATED_SENSOR_EVIDENCE";
    s.charts.add(chart);
    plan.lastConfirmedCareAt = clock.instant();
    plan.confirmedChartId = chart.id;
    plan.confirmedMovementId = m.id;
    for (Task t : s.tasks)
      if (
        t.patientId.equals(patientId) &&
        WorkflowRules.active(t) &&
        (t.type.startsWith("REPOSITION") || m.id.equals(t.relatedMovementId))
      ) {
        t.status = "COMPLETED";
        t.completedAt = clock.instant().toString();
        t.verifiedBy = "nurse-demo";
        event(
          s,
          patientId,
          "task.completed",
          "nurse-demo",
          t.id + ": explicit turn confirmation"
        );
      }
    Task next = new Task(
      id(),
      patientId,
      "Review and document prescribed repositioning",
      "REPOSITION_REVIEW",
      clock.instant().plusSeconds(plan.intervalMinutes * 60L),
      true,
      0
    );
    next.source = "INDIVIDUAL_REPOSITIONING_PLAN";
    s.tasks.add(next);
    event(
      s,
      patientId,
      "movement.reviewed",
      "nurse-demo",
      m.id + ": CONFIRMED_CARE"
    );
    event(
      s,
      patientId,
      "chart.confirmed",
      "nurse-demo",
      chart.id + ": " + c.text()
    );
    event(
      s,
      patientId,
      "repositioning.confirmed",
      "nurse-demo",
      "Next configured turn deadline: " + next.dueAt
    );
    WorkflowRules.apply(s, clock.instant());
    return assigned(save(s));
  }

  public synchronized State repositioningDemo() {
    State s = load();
    Repositioning.initialize(s, clock.instant());
    int index = 0;
    for (Repositioning.Plan plan : s.repositioningPlans) {
      Patient p = s.patients
        .stream()
        .filter(x -> x.id().equals(plan.patientId))
        .findFirst()
        .orElseThrow();
      if (!"nurse-demo".equals(p.nurseId())) continue;
      // Explicit replay changes schedules only, preserving every chart and confirmation.
      if (plan.lastConfirmedCareAt == null) {
        plan.initialDueAt = clock
          .instant()
          .plusSeconds(index == 0 ? -2520 : index == 1 ? 900 : 5400);
        for (Task t : s.tasks)
          if (
            t.patientId.equals(plan.patientId) &&
            t.type.startsWith("REPOSITION") &&
            WorkflowRules.active(t)
          ) t.dueAt = plan.initialDueAt;
      }
      index++;
    }
    monitors.tick(s, clock.instant());
    MonitorSimulation.freshness(s, clock.instant());
    WorkflowRules.apply(s, clock.instant());
    event(
      s,
      null,
      "demo.repositioning",
      "SIMULATOR",
      "Repositioning schedules staged; existing confirmed care preserved"
    );
    save(s);
    return assigned(s);
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
    monitors.ensureDevices(s, clock.instant());
    s.movements.forEach(WorkflowRules::classify);
    s.serverTime = clock.instant();
    MonitorSimulation.freshness(s, clock.instant());
    return assigned(save(s));
  }

  public synchronized State monitorTick() {
    State s = load();
    monitors.tick(s, clock.instant());
    MonitorSimulation.freshness(s, clock.instant());
    WorkflowRules.apply(s, clock.instant());
    save(s);
    return assigned(s);
  }

  public record ScheduleRequest(
    String patientId,
    String title,
    Instant dueAt,
    String priority
  ) {}

  public synchronized Task schedule(ScheduleRequest request) {
    input(
      request != null &&
        request.dueAt() != null &&
        request.title() != null &&
        !request.title().isBlank() &&
        request.title().length() <= 200,
      "Patient, dueAt, and title required (maximum 200 characters)"
    );
    State s = load();
    patient(s, request.patientId());
    String priority =
      request.priority() == null ? "ROUTINE" : request.priority();
    input(
      Set.of("ROUTINE", "TIMELY", "HIGH").contains(priority),
      "Invalid priority"
    );
    Task t = new Task(
      id(),
      request.patientId(),
      request.title(),
      "SCHEDULED_REVIEW",
      request.dueAt(),
      false,
      100
    );
    t.source = "EXPLICIT_DEMO_SCHEDULE";
    t.priority = priority;
    s.tasks.add(t);
    event(
      s,
      t.patientId,
      "task.created",
      "DEMO_OPERATOR",
      t.id + ": " + t.title + " due " + t.dueAt
    );
    WorkflowRules.apply(s, clock.instant());
    save(s);
    return t;
  }

  public record DemoStep(
    String title,
    String method,
    String path,
    Map<String, Object> body,
    String captureAs
  ) {}

  public record DemoPlan(
    String key,
    String patientId,
    String notice,
    List<Round> beforeRounds,
    State state,
    Map<String, String> evidenceIds,
    List<DemoStep> steps
  ) {}

  public static List<String> presetKeys() {
    return List.of(
      "routine-shift",
      "device-event",
      "repositioning",
      "bedside-documentation",
      "adaptive-rounds"
    );
  }

  /** Presets add evidence, never reset a database or impersonate nurse confirmation. */
  public synchronized DemoPlan preset(String key, String patientId) {
    input(presetKeys().contains(key), "Unknown preset");
    State before = load();
    String pid =
      patientId == null
        ? key.equals("repositioning")
          ? "synthetic-icu-01"
          : "synthetic-ld-01"
        : patientId;
    Patient p = patient(before, pid);
    input(
      !key.equals("repositioning") || p.repositionPlan(),
      "Repositioning preset requires an assigned patient with a repositioning plan"
    );
    List<Round> initial = rounds(before, p.unit());
    Map<String, String> evidence = new LinkedHashMap<>();
    List<DemoStep> steps = new ArrayList<>();
    if (
      Set.of("routine-shift", "device-event", "bedside-documentation").contains(
        key
      )
    ) {
      scenario("monitor-reconnect", pid);
      // Fixed scenario value, independent of elapsed time and scheduler timing.
      Vital v = ingest(
        new Observation(
          id(),
          pid,
          "HEART_RATE",
          80,
          "bpm",
          clock.instant(),
          "VALID"
        )
      );
      evidence.put("vitalId", v.id());
    }
    switch (key) {
      case "routine-shift" -> {
        Task t = schedule(
          new ScheduleRequest(
            pid,
            "Routine synthetic bedside review",
            clock.instant().plusSeconds(900),
            "ROUTINE"
          )
        );
        evidence.put("taskId", t.id);
        steps.add(
          new DemoStep(
            "Inspect assigned patients",
            "GET",
            "/api/patients?unit=" + p.unit(),
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect grouped recent monitoring",
            "GET",
            "/api/activity/summary?patientId=" + pid,
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect scheduled rounds",
            "GET",
            "/api/rounds?unit=" + p.unit(),
            Map.of(),
            null
          )
        );
      }
      case "device-event" -> {
        scenario("monitor-disconnect", pid);
        steps.add(
          new DemoStep(
            "Inspect disconnected device metadata",
            "GET",
            "/api/patients/" + pid + "/devices",
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Simulate a delayed connection",
            "POST",
            "/api/demo/scenarios/monitor-delay?patientId=" + pid,
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Receive a delayed reading",
            "POST",
            "/api/demo/scenarios/vital?patientId=" + pid,
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect sampled versus received times",
            "GET",
            "/api/monitoring/updates?patientId=" + pid,
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Reconnect; keep review task for nurse",
            "POST",
            "/api/demo/scenarios/monitor-reconnect?patientId=" + pid,
            Map.of(),
            null
          )
        );
      }
      case "repositioning" -> {
        scenario("reconnect", pid);
        State s = scenario("coordinated", pid);
        Movement m = s.movements.get(s.movements.size() - 1);
        Task t = s.tasks
          .stream()
          .filter(
            x ->
              x.patientId.equals(pid) &&
              x.verificationRequired &&
              WorkflowRules.active(x)
          )
          .findFirst()
          .orElse(null);
        if (t == null) {
          State full = load();
          t = new Task(
            id(),
            pid,
            "Review prescribed synthetic repositioning care",
            "REPOSITION_REVIEW",
            clock.instant(),
            true,
            0
          );
          full.tasks.add(t);
          event(
            full,
            pid,
            "task.created",
            "DEMO_OPERATOR",
            t.id + ": prescribed demo repositioning review"
          );
          WorkflowRules.apply(full, clock.instant());
          save(full);
        }
        evidence.put("movementId", m.id);
        evidence.put("taskId", t.id);
        steps.add(
          new DemoStep(
            "Inspect both regions and review reasons",
            "GET",
            "/api/patients/" + pid + "/sensor-history",
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Nurse reviews bedside evidence explicitly",
            "POST",
            "/api/movements/" + m.id + "/review",
            Map.of(
              "status",
              "CONFIRMED_CARE",
              "verified",
              true,
              "text",
              "Synthetic bedside demonstration: nurse observed prescribed care."
            ),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Nurse documents care completion separately",
            "POST",
            "/api/tasks/" + t.id + "/complete",
            Map.of(
              "verified",
              true,
              "movementId",
              m.id,
              "text",
              "Synthetic prescribed care explicitly verified at bedside."
            ),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect connected history",
            "GET",
            "/api/patients/" + pid + "/sensor-history",
            Map.of(),
            null
          )
        );
      }
      case "bedside-documentation" -> {
        Map<String, Object> body = Map.of(
          "patientId",
          pid,
          "type",
          "OBSERVATION",
          "text",
          "Synthetic bedside observation; monitor evidence reviewed by nurse.",
          "linkedVitalIds",
          List.of(evidence.get("vitalId"))
        );
        steps.add(
          new DemoStep(
            "Nurse creates draft using device evidence",
            "POST",
            "/api/chart/drafts",
            body,
            "draftId"
          )
        );
        steps.add(
          new DemoStep(
            "Nurse confirms draft explicitly",
            "POST",
            "/api/chart/drafts/${draftId}/confirm",
            Map.of("verified", true),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Nurse appends amendment without replacing original",
            "POST",
            "/api/chart/${draftId}/amendments",
            Map.of(
              "patientId",
              pid,
              "type",
              "OBSERVATION",
              "text",
              "Synthetic addendum: bedside observation clarified.",
              "linkedVitalIds",
              List.of(evidence.get("vitalId"))
            ),
            "amendmentId"
          )
        );
        steps.add(
          new DemoStep(
            "Nurse confirms amendment explicitly",
            "POST",
            "/api/chart/drafts/${amendmentId}/confirm",
            Map.of("verified", true),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect confirmation and amendment history",
            "GET",
            "/api/activity/summary?patientId=" + pid,
            Map.of(),
            null
          )
        );
      }
      case "adaptive-rounds" -> {
        Task later = schedule(
          new ScheduleRequest(
            pid,
            "Later synthetic workflow review",
            clock.instant().plusSeconds(5400),
            "ROUTINE"
          )
        );
        Task due = schedule(
          new ScheduleRequest(
            pid,
            "Newly due synthetic workflow review",
            clock.instant(),
            "ROUTINE"
          )
        );
        evidence.put("laterTaskId", later.id);
        evidence.put("taskId", due.id);
        steps.add(
          new DemoStep(
            "Compare beforeRounds with new due ordering and reason codes",
            "GET",
            "/api/rounds?unit=" + p.unit(),
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Nurse acknowledges newly due work",
            "POST",
            "/api/tasks/" + due.id + "/acknowledge",
            Map.of(),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Nurse defers with explicit reason",
            "POST",
            "/api/tasks/" + due.id + "/defer",
            Map.of(
              "reason",
              "Synthetic demonstration: scheduled after current bedside review"
            ),
            null
          )
        );
        steps.add(
          new DemoStep(
            "Inspect new schedule",
            "GET",
            "/api/rounds?unit=" + p.unit(),
            Map.of(),
            null
          )
        );
      }
      default -> throw new IllegalStateException(
        "Validated preset missing implementation"
      );
    }
    State full = load();
    event(
      full,
      pid,
      "demo.preset",
      "DEMO_OPERATOR",
      key + ": additive synthetic setup, explicit nurse actions required"
    );
    save(full);
    return new DemoPlan(
      key,
      pid,
      "Synthetic deterministic setup; no reset or automatic care confirmation. Execute steps explicitly; captureAs binds response.id into later paths.",
      initial,
      assigned(full),
      evidence,
      steps
    );
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

  // ------------------------------------------------ free-form body orientation (simulator input)

  static final Set<String> SENSOR_QUALITIES = Set.of(
    "SIMULATED_GOOD",
    "DELAYED",
    "UNCERTAIN",
    "INCOMPLETE"
  );
  /** Prototype demo threshold for calling a region "moved"; not a validated clinical value. */
  static final double MOVEMENT_THRESHOLD_DEGREES = 15;

  /** Streams one region's roll angle. Idempotent per sourceEventId (used as the sample ID). */
  public synchronized OrientationSample ingestOrientation(OrientationReading in) {
    validSensorEvent(in.sourceEventId(), in.capturedAt());
    input(
      Set.of("UPPER_TORSO", "PELVIS").contains(Objects.toString(in.bodyRegion(), "")),
      "bodyRegion must be UPPER_TORSO or PELVIS"
    );
    input(in.rollDegrees() != null, "rollDegrees required");
    validAngle(in.rollDegrees(), "rollDegrees");
    String quality = sensorQuality(in.quality());
    State s = load();
    patient(s, in.patientId());
    Optional<OrientationSample> previous = sample(s, in.sourceEventId());
    if (previous.isPresent()) {
      OrientationSample o = previous.get();
      require(
        o.patientId().equals(in.patientId()) &&
          o.bodyRegion().equals(in.bodyRegion()) &&
          o.rollDegrees() == in.rollDegrees() &&
          o.capturedAt().equals(in.capturedAt()),
        "Source event ID was already used for different data"
      );
      return o;
    }
    Device d = connectedSensor(s, in.patientId(), in.bodyRegion());
    OrientationSample o = addSample(
      s,
      in.sourceEventId(),
      d,
      in.rollDegrees(),
      in.capturedAt(),
      quality
    );
    MonitorSimulation.freshness(s, clock.instant());
    save(s);
    return o;
  }

  /** Streams both regions in one frame. Sample IDs are sourceEventId + "-UPPER_TORSO"/"-PELVIS". */
  public synchronized List<OrientationSample> ingestPosture(PostureReading in) {
    validSensorEvent(in.sourceEventId(), in.capturedAt());
    input(
      in.upperTorsoDegrees() != null || in.pelvisDegrees() != null,
      "upperTorsoDegrees or pelvisDegrees required"
    );
    validAngle(in.upperTorsoDegrees(), "upperTorsoDegrees");
    validAngle(in.pelvisDegrees(), "pelvisDegrees");
    String quality = sensorQuality(in.quality());
    State s = load();
    patient(s, in.patientId());
    Map<String, Double> regions = new LinkedHashMap<>();
    if (in.upperTorsoDegrees() != null) regions.put("UPPER_TORSO", in.upperTorsoDegrees());
    if (in.pelvisDegrees() != null) regions.put("PELVIS", in.pelvisDegrees());
    List<OrientationSample> existing = regions
      .keySet()
      .stream()
      .map(r -> sample(s, in.sourceEventId() + "-" + r))
      .flatMap(Optional::stream)
      .toList();
    if (!existing.isEmpty()) {
      require(
        existing.size() == regions.size() &&
          existing
            .stream()
            .allMatch(
              o ->
                o.patientId().equals(in.patientId()) &&
                o.rollDegrees() == regions.get(o.bodyRegion()) &&
                o.capturedAt().equals(in.capturedAt())
            ),
        "Source event ID was already used for different data"
      );
      return existing;
    }
    Map<String, Device> sensors = new LinkedHashMap<>();
    regions.keySet().forEach(r -> sensors.put(r, connectedSensor(s, in.patientId(), r)));
    List<OrientationSample> added = new ArrayList<>();
    regions.forEach((r, roll) ->
      added.add(
        addSample(
          s,
          in.sourceEventId() + "-" + r,
          sensors.get(r),
          roll,
          in.capturedAt(),
          quality
        )
      )
    );
    MonitorSimulation.freshness(s, clock.instant());
    save(s);
    return added;
  }

  /**
   * Records a free-form movement candidate with its two region samples. Classification comes
   * from the angle changes; like scripted scenarios it only creates evidence for nurse review.
   */
  public synchronized Movement recordMovement(MovementReading in) {
    validSensorEvent(in.sourceEventId(), in.capturedAt());
    input(in.upperTorsoAfter() != null, "upperTorsoAfter required");
    validAngle(in.upperTorsoBefore(), "upperTorsoBefore");
    validAngle(in.upperTorsoAfter(), "upperTorsoAfter");
    validAngle(in.pelvisBefore(), "pelvisBefore");
    validAngle(in.pelvisAfter(), "pelvisAfter");
    input(
      in.confidence() == null || (in.confidence() >= 0 && in.confidence() <= 1),
      "confidence must be between 0 and 1"
    );
    String quality = sensorQuality(in.quality());
    State s = load();
    Patient p = patient(s, in.patientId());
    input(
      p.repositionPlan(),
      "Movement evidence requires an assigned patient with a repositioning plan"
    );
    Optional<Movement> previous = s.movements
      .stream()
      .filter(x -> x.id.equals(in.sourceEventId()))
      .findFirst();
    if (previous.isPresent()) {
      require(
        previous.get().patientId.equals(in.patientId()),
        "Source event ID was already used for different data"
      );
      return previous.get();
    }
    Device chest = connectedSensor(s, in.patientId(), "UPPER_TORSO");
    Device pelvis = regionSensor(s, in.patientId(), "PELVIS");
    boolean pelvisMissing =
      in.pelvisAfter() == null || pelvis.connectionState.equals("DISCONNECTED");
    Movement m = new Movement();
    m.id = in.sourceEventId();
    m.patientId = in.patientId();
    m.chestSensorId = chest.id;
    m.pelvisSensorId = pelvis.id;
    m.capturedAt = in.capturedAt();
    m.receivedAt = clock.instant();
    m.chestBefore = in.upperTorsoBefore() != null
      ? in.upperTorsoBefore()
      : baseline(s, in.patientId(), chest.id, true);
    m.pelvisBefore = in.pelvisBefore() != null
      ? in.pelvisBefore()
      : baseline(s, in.patientId(), pelvis.id, false);
    m.chestAfter = in.upperTorsoAfter();
    m.pelvisAfter = pelvisMissing ? m.pelvisBefore : in.pelvisAfter();
    boolean chestMoved =
      Math.abs(angleChange(m.chestBefore, m.chestAfter)) >= MOVEMENT_THRESHOLD_DEGREES;
    boolean pelvisMoved =
      !pelvisMissing &&
      Math.abs(angleChange(m.pelvisBefore, m.pelvisAfter)) >= MOVEMENT_THRESHOLD_DEGREES;
    m.classification = pelvisMissing
      ? "UNKNOWN"
      : chestMoved && pelvisMoved
        ? "COORDINATED_TURN_CANDIDATE"
        : chestMoved
          ? "PARTIAL_TORSO_MOVEMENT"
          : pelvisMoved ? "PARTIAL_PELVIC_MOVEMENT" : "SMALL_ADJUSTMENT";
    m.quality = pelvisMissing ? "PELVIS_DISCONNECTED" : quality;
    m.confidence = pelvisMissing
      ? null
      : in.confidence() != null
        ? in.confidence()
        : quality.equals("SIMULATED_GOOD") ? .85 : .35;
    m.sampleIds = new ArrayList<>();
    m.sampleIds.add(
      addSample(s, m.id + "-chest", chest, m.chestAfter, m.capturedAt, m.quality).id()
    );
    if (!pelvisMissing) m.sampleIds.add(
      addSample(s, m.id + "-pelvis", pelvis, m.pelvisAfter, m.capturedAt, m.quality).id()
    );
    WorkflowRules.classify(m);
    s.movements.add(m);
    event(
      s,
      m.patientId,
      "movement.candidate",
      "SIMULATED_SENSOR",
      m.classification + " · " + m.quality + " · free-form simulator input"
    );
    event(
      s,
      m.patientId,
      "movement.detected",
      "SIMULATED_SENSOR",
      "Independent region observations; awaiting nurse review"
    );
    MonitorSimulation.freshness(s, clock.instant());
    WorkflowRules.apply(s, clock.instant());
    save(s);
    return m;
  }

  private void validSensorEvent(String sourceEventId, Instant at) {
    input(
      sourceEventId != null &&
        !sourceEventId.isBlank() &&
        sourceEventId.length() <= 120 &&
        at != null &&
        !at.isAfter(clock.instant().plusSeconds(60)),
      "Valid source event ID (max 120 characters) and capture timestamp required"
    );
  }

  private static void validAngle(Double degrees, String name) {
    input(
      degrees == null || (Double.isFinite(degrees) && Math.abs(degrees) <= 180),
      name + " must be between -180 and 180 degrees"
    );
  }

  private static String sensorQuality(String quality) {
    String q = quality == null ? "SIMULATED_GOOD" : quality;
    input(
      SENSOR_QUALITIES.contains(q),
      "quality must be one of SIMULATED_GOOD, DELAYED, UNCERTAIN, INCOMPLETE"
    );
    return q;
  }

  /** Signed shortest change in degrees, in [-180, 180). */
  static double angleChange(double before, double after) {
    return ((((after - before) % 360) + 540) % 360) - 180;
  }

  private static Optional<OrientationSample> sample(State s, String id) {
    return s.samples.stream().filter(x -> x.id().equals(id)).findFirst();
  }

  private Device regionSensor(State s, String patientId, String region) {
    return s.devices
      .stream()
      .filter(d -> d.patientId.equals(patientId) && region.equals(d.bodyRegion))
      .findFirst()
      .orElseThrow(() ->
        new ResponseStatusException(
          HttpStatus.NOT_FOUND,
          "No " + region + " sensor assigned to this patient"
        )
      );
  }

  private Device connectedSensor(State s, String patientId, String region) {
    Device d = regionSensor(s, patientId, region);
    require(
      !d.connectionState.equals("DISCONNECTED"),
      d.id + " is disconnected; reconnect before sending samples"
    );
    return d;
  }

  /** Settled position: last movement's "after" angle, else the latest sample, else 0. */
  private static double baseline(State s, String patientId, String sensorId, boolean chest) {
    Optional<Movement> last = s.movements
      .stream()
      .filter(m -> m.patientId.equals(patientId))
      .max(Comparator.comparing(m -> m.capturedAt));
    if (last.isPresent()) return chest ? last.get().chestAfter : last.get().pelvisAfter;
    return s.samples
      .stream()
      .filter(x -> x.sensorId().equals(sensorId))
      .max(Comparator.comparing(OrientationSample::capturedAt))
      .map(OrientationSample::rollDegrees)
      .orElse(0.0);
  }

  private OrientationSample addSample(
    State s,
    String id,
    Device d,
    double roll,
    Instant capturedAt,
    String quality
  ) {
    Instant now = clock.instant();
    OrientationSample o = new OrientationSample(
      id,
      d.id,
      d.patientId,
      d.bodyRegion,
      roll,
      capturedAt,
      now,
      quality,
      "SIMULATED"
    );
    s.samples.add(o);
    d.lastSeenAt = now;
    if (d.lastSampledAt == null || capturedAt.isAfter(d.lastSampledAt)) d.lastSampledAt =
      capturedAt;
    return o;
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
        return new Round(
          t,
          reason,
          rank,
          rank <= 1 ? "NOW" : rank == 2 ? "NEXT" : "LATER",
          ClinicalViews.roundReasons(t, s, now)
        );
      })
      .sorted(
        Comparator.comparingInt(Round::rank)
          .thenComparingInt(r -> "TIMELY".equals(r.task().priority) ? 0 : 1)
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
        if (m != null) require(
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
        if (t.verificationRequired) {
          require(
            m != null && m.verificationStatus.equals("CONFIRMED_CARE"),
            "Movement must be nurse-confirmed care for this patient"
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
        if (t.type.startsWith("REPOSITION")) {
          Repositioning.Plan plan = s.repositioningPlans
            .stream()
            .filter(x -> x.patientId.equals(t.patientId))
            .findFirst()
            .orElse(null);
          if (plan != null) {
            plan.lastConfirmedCareAt = clock.instant();
            plan.confirmedChartId = note.id;
            plan.confirmedMovementId = c.movementId();
          }
        }
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
    WorkflowRules.apply(s, clock.instant());
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
      m.id + ": " + c.status() + " · " + Objects.toString(c.text(), "")
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
      WorkflowRules.apply(s, clock.instant());
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
          "no-movement",
          "pelvic-only",
          "sensor-delay",
          "uncertain",
          "incomplete"
        ).contains(key),
        "Unknown scenario"
      );
      String pid = patientId == null ? "synthetic-icu-01" : patientId;
      Patient p = patient(s, pid);
      input(
        p.repositionPlan() ||
          !Set.of(
            "pelvic-only",
            "sensor-delay",
            "uncertain",
            "incomplete"
          ).contains(key),
        "New sensor scenarios require an assigned patient with a repositioning plan"
      );
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
      WorkflowRules.classify(m);
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
          m.quality,
          "SIMULATED"
        )
      );
      chest.lastSeenAt = clock.instant();
      chest.lastSampledAt = m.capturedAt;
      if (
        !m.quality.equals("PELVIS_DISCONNECTED") &&
        !m.quality.equals("INCOMPLETE")
      ) {
        s.samples.add(
          new OrientationSample(
            m.id + "-pelvis",
            pelvis.id,
            target,
            "PELVIS",
            m.pelvisAfter,
            m.capturedAt,
            clock.instant(),
            m.quality,
            "SIMULATED"
          )
        );
        pelvis.lastSeenAt = clock.instant();
        pelvis.lastSampledAt = m.capturedAt;
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
    WorkflowRules.apply(s, clock.instant());
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
