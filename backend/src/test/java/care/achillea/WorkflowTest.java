package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:test;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "app.monitor.enabled=false",
  }
)
class WorkflowTest {

  @Autowired
  CareService service;

  @Autowired
  StoreRepository repo;

  @BeforeEach
  void reset() {
    service.reset();
  }

  Command cmd(String reason, Boolean verified, String movement, String status) {
    return new Command(
      reason,
      "Observed and verified synthetic bedside care",
      verified,
      movement,
      status,
      null,
      null
    );
  }

  Movement latest(State s) {
    return s.movements
      .stream()
      .filter(m -> m.patientId.equals("synthetic-icu-01"))
      .reduce((a, b) -> b)
      .orElseThrow();
  }

  @Test
  void seedAndPersistentRead() {
    State s = service.read();
    assertEquals(6, s.patients.size());
    assertEquals(18, s.tasks.size());
    assertTrue(repo.findById("demo").isPresent());
    assertEquals(10, service.census("L_AND_D").size());
    assertEquals(7, service.census("ICU").size());
    assertEquals(
      3,
      service
        .rounds(s, "L_AND_D")
        .stream()
        .map(r -> r.task().patientId)
        .distinct()
        .count()
    );
  }

  @Test
  void coordinatedMotionNeverCompletesCare() {
    int charts = service.read().charts.size(),
      samples = service.read().samples.size();
    State s = service.scenario("coordinated", null);
    assertEquals("COORDINATED_TURN_CANDIDATE", latest(s).classification);
    assertEquals("OPEN", service.task(s, "task-3").status);
    assertEquals(charts, s.charts.size());
    assertEquals(samples + 2, s.samples.size());
    assertEquals("UNREVIEWED", latest(s).verificationStatus);
  }

  @Test
  void partialMovementIsNotCoordinated() {
    State s = service.scenario("partial", null);
    assertEquals("PARTIAL_TORSO_MOVEMENT", latest(s).classification);
    assertEquals(0, latest(s).pelvisAfter);
    assertEquals("OPEN", service.task(s, "task-3").status);
  }

  @Test
  void disconnectedRemainsUnknownUntilReconnect() {
    service.scenario("disconnect", null);
    State s = service.scenario("coordinated", null);
    assertEquals("UNKNOWN", latest(s).classification);
    assertEquals(1, latest(s).sampleIds.size());
    assertEquals(
      "SIMULATED_GOOD",
      latest(service.scenario("reconnect", null)).quality
    );
  }

  @Test
  void completionRequiresVerifiedCare() {
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand("task-3", "complete", cmd(null, false, null, null))
    );
    String id = latest(service.scenario("coordinated", null)).id;
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand("task-3", "complete", cmd(null, true, id, null))
    );
    service.review(id, cmd(null, true, null, "CONFIRMED_CARE"));
    State s = service.taskCommand(
      "task-3",
      "complete",
      cmd(null, true, id, null)
    );
    assertEquals("COMPLETED", service.task(s, "task-3").status);
    assertTrue(
      s.charts
        .stream()
        .anyMatch(
          c -> "task-3".equals(c.linkedTaskId) && c.status.equals("CONFIRMED")
        )
    );
    assertTrue(
      service
        .rounds(s, "ICU")
        .stream()
        .noneMatch(r -> r.task().id.equals("task-3"))
    );
  }

  @Test
  void deferralRequiresReasonAndIsAudited() {
    assertThrows(ResponseStatusException.class, () ->
      service.taskCommand("task-1", "defer", cmd("", null, null, null))
    );
    State s = service.taskCommand(
      "task-1",
      "defer",
      cmd("Patient requested later review", null, null, null)
    );
    assertEquals("DEFERRED", service.task(s, "task-1").status);
    assertTrue(
      s.events
        .stream()
        .anyMatch(e -> e.details().contains("Patient requested later review"))
    );
  }

  @Test
  void confirmedChartsAreImmutableAndAmendmentsAppend() {
    int baseline = service.read().charts.size();
    Draft d = new Draft(
      "synthetic-ld-01",
      "OBSERVATION",
      "Synthetic observation",
      null,
      List.of(),
      null
    );
    Chart c = service.draft(d, null, null);
    service.confirm(c.id, cmd(null, true, null, null));
    assertThrows(ResponseStatusException.class, () ->
      service.draft(d, c.id, null)
    );
    Chart amendment = service.draft(
      new Draft(d.patientId(), d.type(), "Correction", null, List.of(), null),
      null,
      c.id
    );
    assertEquals(c.id, amendment.amendmentOfId);
    assertEquals(baseline + 2, service.read().charts.size());
    assertEquals(
      "Synthetic observation",
      service.chart(service.read(), c.id).text
    );
  }

  @Test
  void provenanceAndPatientAssignmentAreValidated() {
    String v = service
      .read()
      .vitals.stream()
      .filter(x -> x.patientId().equals("synthetic-ld-01"))
      .findFirst()
      .orElseThrow()
      .id();
    Chart c = service.draft(
      new Draft(
        "synthetic-ld-01",
        "OBSERVATION",
        "Reviewed reading",
        null,
        List.of(v),
        null
      ),
      null,
      null
    );
    assertTrue(c.provenance.contains("SIMULATED_MONITOR"));
    assertThrows(ResponseStatusException.class, () ->
      service.draft(
        new Draft(
          "unassigned",
          "OBSERVATION",
          "Invalid",
          null,
          List.of(),
          null
        ),
        null,
        null
      )
    );
    assertThrows(ResponseStatusException.class, () ->
      service.draft(
        new Draft(
          "synthetic-ld-02",
          "OBSERVATION",
          "Invalid",
          null,
          List.of(v),
          null
        ),
        null,
        null
      )
    );
  }

  @Test
  void roundsUsePriorityThenDueAndStableIds() {
    State s = service.scenario("flagged", "synthetic-ld-01");
    assertEquals(
      "HIGH",
      service.rounds(s, "L_AND_D").getFirst().task().priority
    );
    assertEquals(service.rounds(s, "L_AND_D"), service.rounds(s, "L_AND_D"));
  }

  @Test
  void demoModeGatesAllMutationEndpoints() {
    ApiController controller = new ApiController(service, false);
    assertThrows(ResponseStatusException.class, controller::reset);
    assertThrows(ResponseStatusException.class, () ->
      controller.scenario("vital", null)
    );
    assertThrows(ResponseStatusException.class, () ->
      controller.draft(
        new Draft("synthetic-ld-01", "OBSERVATION", "x", null, List.of(), null)
      )
    );
  }

  @Test
  void readingRetainsSourceAndSeparateTimestamps() {
    State s = service.scenario("vital", "synthetic-ld-01");
    Vital v = s.vitals
      .stream()
      .filter(x -> x.patientId().equals("synthetic-ld-01"))
      .max(java.util.Comparator.comparing(Vital::observedAt))
      .orElseThrow();
    assertEquals("SIMULATED_MONITOR", v.source());
    assertNotNull(v.observedAt());
    assertNotNull(v.receivedAt());
    assertNotNull(v.sourceEventId());
    assertEquals("monitor-synthetic-ld-01", v.sourceId());
  }

  @Test
  void noAiKeyNeededForExplanation() {
    assertNotNull(new ApiController(service, true).explanation("ICU"));
  }

  @Test
  void duplicateSourceEventIsIdempotent() {
    Observation o = new Observation(
      "incoming-1",
      "synthetic-ld-01",
      "HEART_RATE",
      81,
      "bpm",
      java.time.Instant.now().minusSeconds(4),
      "VALID"
    );
    Vital a = service.ingest(o),
      b = service.ingest(o);
    assertEquals(a.id(), b.id());
    assertEquals(
      1,
      service
        .read()
        .vitals.stream()
        .filter(v -> v.sourceEventId().equals("incoming-1"))
        .count()
    );
    assertTrue(a.receivedAt().isAfter(a.observedAt()));
  }
}
