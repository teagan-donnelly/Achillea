package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:repositioning;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
@Import(ClinicalEngineTest.TimeConfig.class)
class RepositioningTest {

  @Autowired
  CareService service;

  @Autowired
  ClinicalEngineTest.MutableClock clock;

  @Autowired
  MockMvc mvc;

  final String pid = "synthetic-icu-01";

  @BeforeEach
  void reset() {
    clock.value = ClinicalEngineTest.NOW;
    service.reset();
  }

  Repositioning.Status snapshot() {
    return service
      .repositioning("ICU")
      .stream()
      .filter(s -> s.patientId().equals(pid))
      .findFirst()
      .orElseThrow();
  }

  Command command(String movement, boolean verified) {
    return new Command(
      null,
      "Observed prescribed turn and checked patient comfort",
      verified,
      movement,
      "CONFIRMED_CARE",
      null,
      null
    );
  }

  @Test
  void boundariesAndUnknownPlan() {
    State state = service.read();
    Patient p = state.patients
      .stream()
      .filter(x -> x.id().equals(pid))
      .findFirst()
      .orElseThrow();
    Repositioning.Plan plan = state.repositioningPlans
      .stream()
      .filter(x -> x.patientId.equals(pid))
      .findFirst()
      .orElseThrow();
    plan.initialDueAt = clock.instant().plusSeconds(3600);
    assertEquals(
      "ON_TRACK",
      Repositioning.status(state, p, clock.instant()).scheduleStatus()
    );
    assertEquals(
      "DUE_SOON",
      Repositioning.status(
        state,
        p,
        clock.instant().plusSeconds(1800)
      ).scheduleStatus()
    );
    assertEquals(
      "DUE_SOON",
      Repositioning.status(state, p, plan.initialDueAt).scheduleStatus()
    );
    assertEquals(
      1,
      Repositioning.status(
        state,
        p,
        plan.initialDueAt.plusSeconds(1)
      ).overdueSeconds()
    );
    state.repositioningPlans.clear();
    assertEquals(
      "UNKNOWN",
      Repositioning.status(state, p, clock.instant()).scheduleStatus()
    );
  }

  @Test
  void movementDoesNotConfirmButExplicitConfirmationPersistsAndAdvances() {
    service.repositioningDemo();
    Instant before = snapshot().nextDueAt();
    State state = service.scenario("coordinated", pid);
    Movement m = state.movements.getLast();
    assertEquals(before, snapshot().nextDueAt());
    assertNull(snapshot().lastConfirmedCareAt());
    assertThrows(ResponseStatusException.class, () ->
      service.confirmTurn(pid, command(m.id, false))
    );
    service.confirmTurn(pid, command(m.id, true));
    assertEquals(clock.instant().plusSeconds(7200), snapshot().nextDueAt());
    assertEquals("ON_TRACK", snapshot().scheduleStatus());
    State persisted = service.read();
    assertTrue(
      persisted.charts
        .stream()
        .anyMatch(
          c -> m.id.equals(c.linkedMovementId) && "CONFIRMED".equals(c.status)
        )
    );
    assertTrue(
      persisted.events
        .stream()
        .anyMatch(e -> "repositioning.confirmed".equals(e.type()))
    );
    assertThrows(ResponseStatusException.class, () ->
      service.confirmTurn(pid, command(m.id, true))
    );
    service.repositioningDemo();
    assertEquals(clock.instant().plusSeconds(7200), snapshot().nextDueAt());
  }

  @Test
  void disconnectedAndDiscrepantEvidenceRemainSeparateFromSchedule() {
    service.repositioningDemo();
    service.scenario("partial", pid);
    assertEquals("REGION_DISCREPANCY", snapshot().evidenceStatus());
    service.scenario("disconnect", pid);
    assertFalse(snapshot().reporting());
    assertEquals("SENSOR_UNAVAILABLE", snapshot().evidenceStatus());
    assertEquals("OVERDUE", snapshot().scheduleStatus());
    assertNull(snapshot().lastConfirmedCareAt());
  }

  @Test
  void queueUnitScopeAndApiValidation() throws Exception {
    service.repositioningDemo();
    var queue = service.repositioning("ICU");
    assertEquals(4, queue.size());
    assertEquals("OVERDUE", queue.getFirst().scheduleStatus());
    assertEquals("OVERDUE", queue.get(1).scheduleStatus());
    assertEquals("DUE_SOON", queue.get(2).scheduleStatus());
    assertTrue(queue.stream().allMatch(Repositioning.Status::reporting));
    assertTrue(queue.stream().anyMatch(p -> p.pendingReviews() > 0));
    State persisted = service.read();
    assertEquals(
      4,
      persisted.patients
        .stream()
        .filter(p -> p.unit().equals("ICU"))
        .count()
    );
    for (var item : queue)
      for (String region : java.util.List.of("UPPER_TORSO", "PELVIS"))
        assertTrue(
          persisted.samples
            .stream()
            .anyMatch(
              sample ->
                sample.patientId().equals(item.patientId()) &&
                sample.bodyRegion().equals(region)
            )
        );
    assertEquals("ON_TRACK", queue.getLast().scheduleStatus());
    assertTrue(
      service
        .repositioning("L_AND_D")
        .stream()
        .allMatch(s -> "UNKNOWN".equals(s.scheduleStatus()))
    );
    mvc.perform(get("/api/repositioning?unit=ICU")).andExpect(status().isOk());
    mvc
      .perform(get("/api/repositioning?unit=INVALID"))
      .andExpect(status().isBadRequest());
    mvc
      .perform(
        post("/api/patients/" + pid + "/repositioning/confirm")
          .contentType("application/json")
          .content("{\"verified\":false}")
      )
      .andExpect(status().isBadRequest());
  }
}
