package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(properties = { "app.monitor.enabled=false" })
@AutoConfigureMockMvc
@Import(ClinicalEngineTest.TimeConfig.class)
class ClinicalEngineTest extends PostgresTestSupport {

  static final Instant NOW = Instant.parse("2026-11-14T14:00:00Z");

  static class MutableClock extends Clock {

    Instant value = NOW;

    void advance(long seconds) {
      value = value.plusSeconds(seconds);
    }

    public ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    public Clock withZone(ZoneId zone) {
      return Clock.fixed(value, zone);
    }

    public Instant instant() {
      return value;
    }
  }

  @TestConfiguration
  static class TimeConfig {

    @Bean
    @Primary
    MutableClock testClock() {
      return new MutableClock();
    }
  }

  @Autowired
  CareService service;

  @Autowired
  MutableClock clock;

  @Autowired
  MockMvc mvc;

  @Autowired
  ObjectMapper json;

  @Autowired
  StoreRepository repo;

  @BeforeEach
  void reset() {
    clock.value = NOW;
    service.reset();
  }

  Command command(String reason, Boolean verified, String move, String status) {
    return new Command(
      reason,
      "Synthetic bedside verification",
      verified,
      move,
      status,
      null,
      null
    );
  }

  Device device(State s, String patient, String region) {
    return s.devices
      .stream()
      .filter(d -> d.patientId.equals(patient) && d.bodyRegion.equals(region))
      .findFirst()
      .orElseThrow();
  }

  Movement latest(State s) {
    return s.movements
      .stream()
      .filter(m -> m.patientId.equals("synthetic-icu-01"))
      .reduce((a, b) -> b)
      .orElseThrow();
  }

  @Test
  void resetIsDeterministicAndClockRelative() throws Exception {
    State a = service.read();
    State b = service.reset();
    var digest = java.security.MessageDigest.getInstance("SHA-256");
    assertArrayEquals(
      digest.digest(json.writeValueAsBytes(a)),
      digest.digest(json.writeValueAsBytes(b)),
      "Entire reset state must be reproducible at the same clock instant"
    );
    clock.advance(7200);
    State later = service.reset();
    assertEquals(NOW.plusSeconds(7200), later.demoStartedAt);
    assertEquals(
      a.tasks.getFirst().dueAt.plusSeconds(7200),
      later.tasks.getFirst().dueAt
    );
    assertTrue(
      later.vitals
        .stream()
        .anyMatch(v -> v.observedAt().equals(clock.instant().minusSeconds(2)))
    );
    assertEquals(a.vitals.getFirst().value(), later.vitals.getFirst().value());
  }

  @Test
  void censusAndAssignmentsAreDistinctAndScoped() throws Exception {
    State s = service.read();
    assertEquals(
      3,
      s.patients
        .stream()
        .filter(p -> p.unit().equals("L_AND_D"))
        .count()
    );
    assertEquals(
      3,
      s.patients
        .stream()
        .filter(p -> p.unit().equals("ICU"))
        .count()
    );
    assertEquals(10, service.census("L_AND_D").size());
    assertEquals(7, service.census("ICU").size());
    State all = json.readValue(
      repo.findById("demo").orElseThrow().payload,
      State.class
    );
    assertEquals(51, all.tasks.size());
    assertTrue(all.events.size() > 100);
    assertTrue(
      s.tasks
        .stream()
        .allMatch(t ->
          s.patients.stream().anyMatch(p -> p.id().equals(t.patientId))
        )
    );
    assertTrue(
      s.events
        .stream()
        .allMatch(
          e ->
            e.patientId() == null ||
            s.patients.stream().anyMatch(p -> p.id().equals(e.patientId()))
        )
    );
    mvc
      .perform(get("/api/patients/synthetic-ld-04"))
      .andExpect(status().isNotFound());
    mvc
      .perform(get("/api/patients").param("unit", "ICU"))
      .andExpect(jsonPath("$.length()").value(3));
    mvc
      .perform(get("/api/demo/census").param("unit", "ICU"))
      .andExpect(jsonPath("$.patients.length()").value(7))
      .andExpect(jsonPath("$.scope").value("SYNTHETIC_UNIT_CENSUS"));
  }

  @Test
  void unauthorizedTaskChartAndMovementWritesAreRejected() {
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand(
        "seed-task-synthetic-ld-04-1",
        "acknowledge",
        command(null, null, null, null)
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      service.confirm(
        "seed-chart-synthetic-ld-04",
        command(null, true, null, null)
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      service.review(
        "seed-movement-synthetic-icu-04",
        command(null, true, null, "CONFIRMED_CARE")
      )
    );
  }

  @Test
  void historiesVaryHaveCorrectUnitsSourcesAndLimits() throws Exception {
    State s = service.read();
    List<Vital> hr = s.vitals
      .stream()
      .filter(
        v ->
          v.patientId().equals("synthetic-ld-01") &&
          v.metric().equals("HEART_RATE")
      )
      .toList();
    assertEquals(31, hr.size());
    assertTrue(hr.stream().map(Vital::value).distinct().count() > 5);
    assertTrue(
      hr
        .stream()
        .allMatch(
          v ->
            v.unit().equals("bpm") &&
            !v.receivedAt().isBefore(v.observedAt()) &&
            v.sourceId().equals("monitor-synthetic-ld-01")
        )
    );
    mvc
      .perform(
        get("/api/patients/synthetic-ld-01/vitals")
          .param("metric", "HEART_RATE")
          .param("limit", "5")
      )
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.length()").value(5))
      .andExpect(jsonPath("$[0].metric").value("HEART_RATE"));
    mvc
      .perform(
        get("/api/patients/synthetic-ld-01/vitals")
          .param("from", NOW.minusSeconds(300).toString())
          .param("metric", "HEART_RATE")
      )
      .andExpect(jsonPath("$.length()").value(3));
    mvc
      .perform(
        get("/api/patients/synthetic-ld-01/vitals")
          .param("from", NOW.toString())
          .param("to", NOW.minusSeconds(1).toString())
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(
        get("/api/patients/synthetic-ld-01/vitals").param(
          "from",
          "not-an-instant"
        )
      )
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.correlationId").exists());
  }

  @Test
  void stalenessUsesSampleTimeNotReceiptTime() {
    State s = service.read();
    assertEquals(
      "FRESH",
      device(s, "synthetic-ld-01", "BEDSIDE_MONITOR").freshness
    );
    assertEquals(
      "DISCONNECTED",
      device(s, "synthetic-ld-02", "BEDSIDE_MONITOR").freshness
    );
    assertEquals(
      "STALE",
      device(s, "synthetic-ld-03", "BEDSIDE_MONITOR").freshness
    );
    clock.advance(65);
    assertEquals(
      "STALE",
      device(service.read(), "synthetic-ld-01", "BEDSIDE_MONITOR").freshness
    );
    service.scenario("monitor-delay", "synthetic-ld-01");
    service.scenario("vital", "synthetic-ld-01");
    Device d = device(service.read(), "synthetic-ld-01", "BEDSIDE_MONITOR");
    assertEquals(clock.instant(), d.lastSeenAt);
    assertEquals("STALE", d.freshness);
  }

  @Test
  void tickGeneratesRecentDataWithoutWritingChartsOrConfirmingCare() {
    State before = service.read();
    clock.advance(15);
    State after = service.monitorTick();
    assertTrue(after.vitals.size() > before.vitals.size());
    assertEquals(before.charts.size(), after.charts.size());
    assertEquals(before.movements.size(), after.movements.size());
    assertEquals(1, after.monitorTick);
    Vital v = after.vitals
      .stream()
      .filter(x -> x.patientId().equals("synthetic-ld-01"))
      .max(Comparator.comparing(Vital::observedAt))
      .orElseThrow();
    assertEquals(clock.instant().minusSeconds(1), v.observedAt());
    assertEquals(clock.instant(), v.receivedAt());
  }

  @Test
  void disconnectedMonitorStopsUntilExplicitReconnect() {
    service.scenario("monitor-disconnect", "synthetic-ld-01");
    long count = service
      .read()
      .vitals.stream()
      .filter(v -> v.patientId().equals("synthetic-ld-01"))
      .count();
    clock.advance(30);
    service.monitorTick();
    assertEquals(
      count,
      service
        .read()
        .vitals.stream()
        .filter(v -> v.patientId().equals("synthetic-ld-01"))
        .count()
    );
    assertThrows(ResponseStatusException.class, () ->
      service.scenario("vital", "synthetic-ld-01")
    );
    service.scenario("monitor-reconnect", "synthetic-ld-01");
    assertEquals(
      "FRESH",
      device(service.read(), "synthetic-ld-01", "BEDSIDE_MONITOR").freshness
    );
  }

  @Test
  void automaticTransientConnectionEventsAreCoherent() {
    for (int i = 0; i < 15; i++) {
      clock.advance(15);
      service.monitorTick();
    }
    State s = service.read();
    assertTrue(
      s.vitals
        .stream()
        .anyMatch(
          v ->
            v.patientId().equals("synthetic-ld-01") &&
            v.quality().equals("DELAYED") &&
            v.receivedAt().isAfter(v.observedAt().plusSeconds(60))
        )
    );
    assertTrue(
      s.events
        .stream()
        .anyMatch(
          e ->
            e.patientId() != null &&
            e.patientId().equals("synthetic-ld-01") &&
            e.type().equals("device.disconnected")
        )
    );
    assertTrue(
      s.events
        .stream()
        .anyMatch(
          e ->
            e.patientId() != null &&
            e.patientId().equals("synthetic-ld-01") &&
            e.type().equals("device.delayed")
        )
    );
    assertTrue(
      s.events
        .stream()
        .anyMatch(
          e ->
            e.patientId() != null &&
            e.patientId().equals("synthetic-ld-01") &&
            e.type().equals("device.connected")
        )
    );
  }

  @Test
  void sensorChronologyQualityAndIndependentRegions() {
    clock.advance(1);
    Movement partial = latest(service.scenario("partial", null));
    clock.advance(1);
    Movement coordinated = latest(service.scenario("coordinated", null));
    assertEquals(partial.pelvisAfter, coordinated.pelvisBefore);
    assertEquals(35, coordinated.pelvisAfter - coordinated.pelvisBefore);
    assertTrue(coordinated.capturedAt.isAfter(partial.capturedAt));
    assertEquals("UNREVIEWED", coordinated.verificationStatus);
    assertNotNull(coordinated.confidence);
    clock.advance(1);
    Movement minor = latest(service.scenario("minor", null));
    assertEquals("SMALL_ADJUSTMENT", minor.classification);
    assertEquals(4, minor.chestAfter - minor.chestBefore);
    assertEquals("torso-sim-01", minor.chestSensorId);
    clock.advance(1);
    Movement unknown = latest(service.scenario("disconnect", null));
    assertNull(unknown.confidence);
    assertEquals("UNKNOWN", unknown.classification);
    clock.advance(1);
    State still = service.scenario("coordinated", null);
    assertEquals("UNKNOWN", latest(still).classification);
    assertTrue(
      still.samples
        .stream()
        .noneMatch(x -> x.id().equals(latest(still).id + "-pelvis"))
    );
    clock.advance(1);
    assertEquals(
      "SIMULATED_GOOD",
      latest(service.scenario("reconnect", null)).quality
    );
  }

  @Test
  void allRoundsHorizonsAndTransitionsArePersistent() {
    List<Round> rounds = service.rounds(service.read(), "L_AND_D");
    assertEquals(
      Set.of("NOW", "NEXT", "LATER"),
      rounds
        .stream()
        .map(Round::horizon)
        .collect(java.util.stream.Collectors.toSet())
    );
    assertTrue(
      rounds.stream().allMatch(r -> r.reason() != null && !r.reason().isBlank())
    );
    service.taskCommand(
      "task-1",
      "acknowledge",
      command(null, null, null, null)
    );
    assertEquals("ACKNOWLEDGED", service.task(service.read(), "task-1").status);
    service.taskCommand(
      "task-1",
      "defer",
      command("Requested later review", null, null, null)
    );
    assertEquals(
      NOW.plusSeconds(1800),
      service.task(service.read(), "task-1").dueAt
    );
    service.taskCommand(
      "task-4",
      "reorder",
      new Command(null, null, null, null, null, -1, null)
    );
    assertEquals(-1, service.task(service.read(), "task-4").order);
    service.taskCommand(
      "task-4",
      "priority",
      new Command(null, null, null, null, null, null, "HIGH")
    );
    assertEquals(
      "task-4",
      service.rounds(service.read(), "L_AND_D").getFirst().task().id
    );
    service.taskCommand("task-4", "complete", command(null, true, null, null));
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand(
        "task-4",
        "defer",
        command("Cannot reopen", null, null, null)
      )
    );
  }

  @Test
  void nullCommandsAndUnknownActionsReturnStructuredErrors() throws Exception {
    mvc
      .perform(
        post("/api/tasks/task-1/priority")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isBadRequest())
      .andExpect(jsonPath("$.correlationId").exists());
    mvc
      .perform(
        post("/api/movements/seed-movement-synthetic-icu-01/review")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(
        post("/api/tasks/task-1/nonexistent")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isBadRequest());
  }

  @Test
  void amendmentEditingPreservesOriginalLinkAndAudit() throws Exception {
    String original = "seed-chart-synthetic-ld-01";
    Draft d = new Draft(
      "synthetic-ld-01",
      "OBSERVATION",
      "First correction",
      null,
      List.of(),
      null
    );
    Chart c = service.draft(d, null, original);
    c = service.draft(
      new Draft(
        d.patientId(),
        d.type(),
        "Revised correction",
        null,
        List.of(),
        null
      ),
      c.id,
      null
    );
    assertEquals(original, c.amendmentOfId);
    service.confirm(c.id, command(null, true, null, null));
    assertEquals("AMENDED", service.chart(service.read(), c.id).status);
    assertNotEquals(
      "Revised correction",
      service.chart(service.read(), original).text
    );
    mvc
      .perform(
        get("/api/events")
          .param("patientId", "synthetic-ld-01")
          .param("type", "chart.amended")
      )
      .andExpect(jsonPath("$.length()").value(1));
    assertTrue(
      service
        .read()
        .events.stream()
        .anyMatch(e -> e.type().equals("chart.created"))
    );
  }

  @Test
  void crossPatientMovementLinksCannotBeWritten() {
    assertThrows(ResponseStatusException.class, () ->
      service.draft(
        new Draft(
          "synthetic-ld-01",
          "OBSERVATION",
          "Invalid linkage",
          null,
          List.of(),
          "seed-movement-synthetic-icu-01"
        ),
        null,
        null
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand(
        "task-1",
        "complete",
        command(null, true, "seed-movement-synthetic-icu-01", null)
      )
    );
  }

  @Test
  void oldSnapshotsArePreservedWithoutImplicitReseed() throws Exception {
    State old = new State();
    old.patients.add(
      new Patient(
        "legacy",
        "Fictional legacy",
        "L1",
        "L_AND_D",
        "Legacy synthetic case",
        "nurse-demo",
        false
      )
    );
    Chart c = new Chart();
    c.id = "legacy-chart";
    c.patientId = "legacy";
    c.text = "Preserve this record";
    c.status = "CONFIRMED";
    c.authoredAt = c.confirmedAt = NOW;
    old.charts.add(c);
    Store row = repo.findById("demo").orElseThrow();
    row.payload = json.writeValueAsString(old);
    repo.saveAndFlush(row);
    State restored = service.read();
    assertEquals(1, restored.patients.size());
    assertEquals("Preserve this record", restored.charts.getFirst().text);
    assertEquals(1, restored.devices.size());
    assertEquals("UNKNOWN", restored.devices.getFirst().freshness);
  }

  @Test
  void zoneDoesNotChangeTheSchedule() {
    DemoSeeder seeder = new DemoSeeder();
    State utc = seeder.create(Clock.fixed(NOW, ZoneOffset.UTC).instant());
    State eastern = seeder.create(
      Clock.fixed(NOW, ZoneId.of("America/New_York")).instant()
    );
    assertEquals(utc.tasks.getFirst().dueAt, eastern.tasks.getFirst().dueAt);
  }

  @Test
  void legacyDisconnectedSensorDoesNotBecomeConnectedAfterUpgrade()
    throws Exception {
    State s = service.scenario("disconnect", null);
    s.devices.clear();
    Store row = repo.findById("demo").orElseThrow();
    row.payload = json.writeValueAsString(s);
    repo.saveAndFlush(row);
    assertEquals(
      "DISCONNECTED",
      device(service.read(), "synthetic-icu-01", "PELVIS").connectionState
    );
    clock.advance(1);
    assertEquals(
      "UNKNOWN",
      latest(service.scenario("coordinated", null)).classification
    );
  }

  @Test
  void legacyDelayedMeasurementRetainsItsActualCaptureAge() throws Exception {
    State s = service.read();
    s.devices.clear();
    s.vitals.add(
      new Vital(
        "legacy-delayed",
        "synthetic-ld-01",
        "HEART_RATE",
        79,
        "bpm",
        NOW.minusSeconds(300),
        NOW,
        "SIMULATED_MONITOR",
        "legacy-delayed",
        "VALID"
      )
    );
    s.charts.removeIf(c -> c.patientId.equals("synthetic-ld-01")); // Build a consistent legacy fixture before removing its measurements.
    // This is the most recently received packet; it is not a freshly sampled measurement.
    s.vitals.removeIf(
      v ->
        v.patientId().equals("synthetic-ld-01") &&
        !v.id().equals("legacy-delayed")
    );
    Store row = repo.findById("demo").orElseThrow();
    row.payload = json.writeValueAsString(s);
    repo.saveAndFlush(row);
    Device d = device(service.read(), "synthetic-ld-01", "BEDSIDE_MONITOR");
    assertEquals(NOW, d.lastSeenAt);
    assertEquals(NOW.minusSeconds(300), d.lastSampledAt);
    assertEquals("STALE", d.freshness);
  }

  @Test
  void confirmedMovementCannotCompleteMultipleCareTasks() {
    String move = latest(service.scenario("coordinated", null)).id;
    service.review(move, command(null, true, null, "CONFIRMED_CARE"));
    service.taskCommand("task-3", "complete", command(null, true, move, null));
    // A second same-patient verification-required task must not reuse the old care confirmation.
    Store row = repo.findById("demo").orElseThrow();
    try {
      State s = json.readValue(row.payload, State.class);
      s.tasks.add(
        new Task(
          "second-turn",
          "synthetic-icu-01",
          "Second review",
          "REPOSITION_REVIEW",
          NOW,
          true,
          0
        )
      );
      row.payload = json.writeValueAsString(s);
      repo.saveAndFlush(row);
    } catch (Exception e) {
      throw new AssertionError(e);
    }
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand(
        "second-turn",
        "complete",
        command(null, true, move, null)
      )
    );
  }
}
