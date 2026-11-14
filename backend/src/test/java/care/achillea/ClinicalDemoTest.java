package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:clinical-demo;DB_CLOSE_DELAY=-1",
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
@Import(ClinicalEngineTest.TimeConfig.class)
class ClinicalDemoTest {

  @Test
  void workspaceScopesWorkflowWithoutResendingOrErasingObservationHistory()
    throws Exception {
    mvc
      .perform(get("/api/workspace?unit=ICU"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.patients.length()").value(3))
      .andExpect(jsonPath("$.tasks.length()").value(9))
      .andExpect(jsonPath("$.vitals.length()").value(0))
      .andExpect(jsonPath("$.events.length()").value(0))
      .andExpect(jsonPath("$.samples.length()").value(0))
      .andExpect(jsonPath("$.patients[0].unit").value("ICU"));
    assertTrue(service.read().vitals.size() > 0);
    assertTrue(service.read().events.size() > 0);
    mvc
      .perform(get("/api/workspace?unit=INVALID"))
      .andExpect(status().isBadRequest());
  }

  @Autowired
  CareService service;

  @Autowired
  ClinicalEngineTest.MutableClock clock;

  @Autowired
  MockMvc mvc;

  @Autowired
  ObjectMapper json;

  @Autowired
  StoreRepository repo;

  static final String LD = "synthetic-ld-01",
    ICU = "synthetic-icu-01";

  @BeforeEach
  void reset() {
    clock.value = ClinicalEngineTest.NOW;
    service.reset();
  }

  @Test
  void summariesAccountForEveryMeasurementWithoutInventingCountsOrDeletingEvents()
    throws Exception {
    service.scenario("flagged", LD);
    State state = service.read();
    List<ClinicalViews.ActivityItem> items = ClinicalViews.activity(state);
    List<String> refs = items
      .stream()
      .flatMap(x -> x.measurementIds().stream())
      .toList();
    assertEquals(state.vitals.size(), refs.size());
    assertEquals(state.vitals.size(), new HashSet<>(refs).size());
    assertEquals(
      new HashSet<>(state.vitals.stream().map(Vital::id).toList()),
      new HashSet<>(refs)
    );
    assertTrue(
      items
        .stream()
        .anyMatch(
          x ->
            x.category().equals("MEASUREMENT") &&
            x.summary().contains("REVIEW_REQUESTED_DEMO_RULE")
        )
    );
    for (var item : items) {
      if (!item.category().equals("MONITORING_SUMMARY")) continue;
      assertEquals(item.count(), item.measurementIds().size());
      assertEquals(item.count(), item.sourceEventIds().size());
      assertTrue(
        state.vitals
          .stream()
          .filter(v -> item.measurementIds().contains(v.id()))
          .allMatch(
            v ->
              item.patientId().equals(v.patientId()) &&
              item.sourceId().equals(v.sourceId()) &&
              Math.floorDiv(v.receivedAt().getEpochSecond(), 900) ==
                Math.floorDiv(item.startedAt().getEpochSecond(), 900)
          )
      );
    }
    long rawBefore = state.events.size();
    mvc
      .perform(get("/api/activity/summary").param("patientId", LD))
      .andExpect(status().isOk());
    assertEquals(rawBefore, service.read().events.size());
  }

  @Test
  void auditAndMeasurementEvidenceAreRetainedBeyondOldLimits()
    throws Exception {
    Store row = repo.findById("demo").orElseThrow();
    State state = json.readValue(row.payload, State.class);
    for (int i = 0; i < 4100; i++) state.events.add(
      new Event(
        "retention-" + i,
        LD,
        "test.evidence",
        "TEST",
        "raw evidence",
        clock.instant()
      )
    );
    for (int i = 0; i < 400; i++) state.vitals.add(
      new Vital(
        "retained-vital-" + i,
        LD,
        "HEART_RATE",
        80,
        "bpm",
        clock.instant(),
        clock.instant(),
        "SIMULATED_MONITOR",
        "retained-source-" + i,
        "VALID"
      )
    );
    row.payload = json.writeValueAsString(state);
    repo.saveAndFlush(row);
    clock.advance(15);
    State after = service.monitorTick();
    assertTrue(
      after.events.stream().anyMatch(e -> e.id().equals("retention-0"))
    );
    assertEquals(
      4100,
      after.events
        .stream()
        .filter(e -> e.id().startsWith("retention-"))
        .count()
    );
    assertEquals(
      400,
      after.vitals
        .stream()
        .filter(v -> v.id().startsWith("retained-vital-"))
        .count()
    );
  }

  @Test
  void inclusivePollingIncludesDelayedAndEqualTimestampArrivalsAndScopesUnits()
    throws Exception {
    clock.advance(1);
    service.scenario("monitor-delay", LD);
    service.scenario("vital", LD);
    service.scenario("vital", LD);
    JsonNode data = json.readTree(
      mvc
        .perform(
          get("/api/monitoring/updates")
            .param("patientId", LD)
            .param("since", clock.instant().toString())
        )
        .andExpect(status().isOk())
        .andReturn()
        .getResponse()
        .getContentAsString()
    );
    assertEquals(2, data.get("measurements").size());
    assertTrue(data.get("inclusive").asBoolean());
    assertEquals(clock.instant().toString(), data.get("nextSince").asText());
    for (JsonNode v : data.get("measurements")) {
      assertEquals("DELAYED", v.get("quality").asText());
      assertEquals(
        clock.instant().minusSeconds(90),
        Instant.parse(v.get("observedAt").asText())
      );
    }
    assertEquals("STALE", data.get("devices").get(0).get("freshness").asText());
    JsonNode icu = json.readTree(
      mvc
        .perform(get("/api/monitoring/updates").param("unit", "ICU"))
        .andExpect(status().isOk())
        .andReturn()
        .getResponse()
        .getContentAsString()
    );
    for (JsonNode v : icu.get("measurements"))
      assertTrue(v.get("patientId").asText().contains("icu"));
    mvc
      .perform(
        get("/api/monitoring/updates").param(
          "since",
          clock.instant().plusSeconds(1).toString()
        )
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(get("/api/monitoring/updates").param("since", "invalid"))
      .andExpect(status().isBadRequest());
  }

  @Test
  void deviceSpecificIntervalsAndQualityFlagsDoNotInferCare() throws Exception {
    Store row = repo.findById("demo").orElseThrow();
    State state = json.readValue(row.payload, State.class);
    state.devices.forEach(d -> {
      d.connectionState = "CONNECTED";
      d.manualOverride = true;
      d.lastSeenAt = clock.instant();
    });
    row.payload = json.writeValueAsString(state);
    repo.saveAndFlush(row);
    int charts = state.charts.size();
    clock.advance(15);
    State after = service.monitorTick();
    assertEquals(
      15,
      after.devices
        .stream()
        .filter(d -> d.patientId.equals(LD))
        .findFirst()
        .orElseThrow()
        .updateIntervalSeconds
    );
    assertTrue(
      after.vitals
        .stream()
        .anyMatch(
          v ->
            v.patientId().equals(LD) && v.receivedAt().equals(clock.instant())
        )
    );
    assertFalse(
      after.vitals
        .stream()
        .anyMatch(
          v ->
            v.patientId().equals("synthetic-ld-02") &&
            v.receivedAt().equals(clock.instant())
        )
    );
    for (int i = 1; i < 23; i++) {
      clock.advance(15);
      after = service.monitorTick();
    }
    assertTrue(
      after.vitals
        .stream()
        .anyMatch(v -> v.quality().equals("SUSPECTED_ARTIFACT"))
    );
    assertEquals(
      charts,
      json
        .readValue(repo.findById("demo").orElseThrow().payload, State.class)
        .charts.size()
    );
  }

  @Test
  void sensorEvidenceCoversIndependentRegionsDelayUncertaintyAndIncompleteSamples()
    throws Exception {
    for (String key : List.of(
      "partial",
      "pelvic-only",
      "minor",
      "sensor-delay",
      "uncertain",
      "incomplete",
      "disconnect",
      "reconnect",
      "coordinated"
    )) {
      Set<String> before = new HashSet<>(
        service
          .read()
          .movements.stream()
          .map(m -> m.id)
          .toList()
      );
      State state = service.scenario(key, ICU);
      Movement m = state.movements
        .stream()
        .filter(x -> !before.contains(x.id))
        .findFirst()
        .orElseThrow();
      assertEquals("UNREVIEWED", m.verificationStatus);
      assertEquals(
        key.equals("incomplete") || key.equals("disconnect") ? 1 : 2,
        m.sampleIds.size()
      );
      assertTrue(
        state.samples
          .stream()
          .map(OrientationSample::id)
          .toList()
          .containsAll(m.sampleIds)
      );
      if (key.equals("pelvic-only")) {
        assertEquals(m.chestBefore, m.chestAfter);
        assertNotEquals(m.pelvisBefore, m.pelvisAfter);
        assertEquals("PARTIAL_PELVIC_MOVEMENT", m.classification);
      }
      if (key.equals("sensor-delay")) {
        assertEquals(
          90,
          Duration.between(m.capturedAt, m.receivedAt).getSeconds()
        );
        assertTrue(
          state.devices
            .stream()
            .filter(
              d ->
                d.patientId.equals(ICU) &&
                !d.bodyRegion.equals("BEDSIDE_MONITOR")
            )
            .allMatch(d -> d.freshness.equals("STALE"))
        );
      }
      if (!Set.of("minor", "reconnect").contains(key)) {
        assertTrue(m.reviewRequired);
        assertFalse(m.reviewReasonCodes.isEmpty());
        assertTrue(
          state.tasks.stream().anyMatch(t -> m.id.equals(t.relatedMovementId))
        );
      }
      clock.advance(1);
    }
    JsonNode history = json.readTree(
      mvc
        .perform(get("/api/patients/" + ICU + "/sensor-history"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.orientationUnit").value("degrees"))
        .andReturn()
        .getResponse()
        .getContentAsString()
    );
    int connectionChanges = 0;
    for (JsonNode event : history.get("connectivityEvents"))
      if (
        Set.of("device.disconnected", "device.connected").contains(
          event.get("type").asText()
        )
      ) connectionChanges++;
    assertEquals(2, connectionChanges);
    assertEquals("OPEN", service.task(service.read(), "task-3").status);
  }

  @Test
  void technicalReviewAndScheduleTransitionsAreExplicitAndDoNotAutoComplete() {
    service.scenario("monitor-disconnect", LD);
    Task technical = service
      .read()
      .tasks.stream()
      .filter(t -> "monitor-".concat(LD).equals(t.relatedDeviceId))
      .findFirst()
      .orElseThrow();
    service.scenario("monitor-reconnect", LD);
    assertEquals("OPEN", service.task(service.read(), technical.id).status);
    Task due = service.schedule(
      new CareService.ScheduleRequest(
        LD,
        "Deterministic review",
        clock.instant(),
        null
      )
    );
    assertTrue(
      service
        .rounds(service.read(), "L_AND_D")
        .stream()
        .filter(r -> r.task().id.equals(due.id))
        .findFirst()
        .orElseThrow()
        .reasonCodes()
        .contains("SCHEDULED_DUE")
    );
    clock.advance(1);
    service.monitorTick();
    assertEquals(
      1,
      service
        .read()
        .events.stream()
        .filter(
          e ->
            e.type().equals("task.schedule.overdue") &&
            e.details().contains(due.id)
        )
        .count()
    );
    service.monitorTick();
    assertEquals(
      1,
      service
        .read()
        .events.stream()
        .filter(
          e ->
            e.type().equals("task.schedule.overdue") &&
            e.details().contains(due.id)
        )
        .count()
    );
    service.taskCommand(
      due.id,
      "acknowledge",
      new Command(null, null, null, null, null, null, null)
    );
    service.taskCommand(
      due.id,
      "defer",
      new Command(
        "Bedside review scheduled next",
        null,
        null,
        null,
        null,
        null,
        null
      )
    );
    Round deferred = service
      .rounds(service.read(), "L_AND_D")
      .stream()
      .filter(r -> r.task().id.equals(due.id))
      .findFirst()
      .orElseThrow();
    assertEquals("NEXT", deferred.horizon());
    assertTrue(deferred.reasonCodes().contains("NURSE_DEFERRED"));
  }

  @Test
  void everyPresetExecutesItsRealApiGuideAndRepeatsWithoutTimerRaces()
    throws Exception {
    for (String key : CareService.presetKeys()) {
      List<String> signatures = new ArrayList<>();
      for (int attempt = 0; attempt < 2; attempt++) {
        reset();
        State original = service.read();
        JsonNode plan = json.readTree(
          mvc
            .perform(post("/api/demo/presets/" + key))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString()
        );
        assertEquals(
          original.charts.size(),
          service.read().charts.size(),
          "Preset cannot confirm or create nursing documentation"
        );
        Map<String, String> bindings = new HashMap<>();
        for (JsonNode step : plan.get("steps")) {
          String path = step.get("path").asText();
          for (var b : bindings.entrySet())
            path = path.replace("${" + b.getKey() + "}", b.getValue());
          var request = step.get("method").asText().equals("GET")
            ? get(path)
            : post(path)
                .contentType("application/json")
                .content(json.writeValueAsString(step.get("body")));
          JsonNode result = json.readTree(
            mvc
              .perform(request)
              .andExpect(status().isOk())
              .andReturn()
              .getResponse()
              .getContentAsString()
          );
          if (!step.get("captureAs").isNull()) bindings.put(
            step.get("captureAs").asText(),
            result.get("id").asText()
          );
        }
        State after = service.read();
        if (key.equals("bedside-documentation")) {
          Chart originalChart = service.chart(after, bindings.get("draftId"));
          Chart amendment = service.chart(after, bindings.get("amendmentId"));
          assertEquals("CONFIRMED", originalChart.status);
          assertEquals("AMENDED", amendment.status);
          assertEquals(originalChart.id, amendment.amendmentOfId);
          assertTrue(originalChart.text.contains("monitor evidence"));
        }
        if (key.equals("repositioning")) {
          String mid = plan.get("evidenceIds").get("movementId").asText();
          assertEquals(
            "CONFIRMED_CARE",
            service.movement(after, mid).verificationStatus
          );
          assertEquals(
            "COMPLETED",
            service
              .task(after, plan.get("evidenceIds").get("taskId").asText())
              .status
          );
          mvc
            .perform(get("/api/patients/" + ICU + "/sensor-history"))
            .andExpect(status().isOk());
        }
        signatures.add(
          after.charts.size() +
            "/" +
            after.tasks.size() +
            "/" +
            after.events.stream().map(Event::type).sorted().toList()
        );
      }
      assertEquals(
        signatures.get(0),
        signatures.get(1),
        key + " must have repeatable workflow outcomes"
      );
    }
  }

  @Test
  void additiveEndpointsValidateAssignmentsAndMalformedInputs()
    throws Exception {
    for (String key : List.of(
      "pelvic-only",
      "sensor-delay",
      "uncertain",
      "incomplete"
    ))
      mvc
        .perform(post("/api/demo/scenarios/" + key + "?patientId=" + LD))
        .andExpect(status().isBadRequest());
    for (String path : List.of(
      "/api/activity/summary?patientId=synthetic-ld-04",
      "/api/monitoring/updates?patientId=synthetic-icu-04",
      "/api/patients/synthetic-icu-04/sensor-history"
    ))
      mvc.perform(get(path)).andExpect(status().isNotFound());
    mvc
      .perform(post("/api/demo/presets/device-event?patientId=synthetic-ld-04"))
      .andExpect(status().isNotFound());
    mvc
      .perform(post("/api/demo/presets/repositioning?patientId=" + LD))
      .andExpect(status().isBadRequest());
    mvc
      .perform(post("/api/demo/presets/unknown"))
      .andExpect(status().isBadRequest());
    mvc
      .perform(get("/api/activity/summary?unit=UNKNOWN"))
      .andExpect(status().isBadRequest());
    mvc
      .perform(
        post("/api/demo/tasks").contentType("application/json").content("{}")
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(
        post("/api/demo/tasks")
          .contentType("application/json")
          .content(
            "{\"patientId\":\"synthetic-ld-04\",\"title\":\"Review\",\"dueAt\":\"2026-11-14T14:00:00Z\"}"
          )
      )
      .andExpect(status().isNotFound());
    mvc
      .perform(get("/api/demo/presets"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.keys.length()").value(5));
  }

  @Test
  void completedMovementCannotBeReusedEvenByANonRepositioningTask() {
    var plan = service.preset("repositioning", ICU);
    String movement = plan.evidenceIds().get("movementId");
    service.review(
      movement,
      new Command(
        null,
        "Synthetic bedside care observed",
        true,
        null,
        "CONFIRMED_CARE",
        null,
        null
      )
    );
    service.taskCommand(
      plan.evidenceIds().get("taskId"),
      "complete",
      new Command(null, "First verified care", true, movement, null, null, null)
    );
    Task second = service.schedule(
      new CareService.ScheduleRequest(
        ICU,
        "Separate review",
        clock.instant(),
        null
      )
    );
    var error = assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () ->
        service.taskCommand(
          second.id,
          "complete",
          new Command(null, "Attempted reuse", true, movement, null, null, null)
        )
    );
    assertEquals(409, error.getStatusCode().value());
    assertEquals("OPEN", service.task(service.read(), second.id).status);
  }

  @Test
  void adaptiveRoundsAndMissingEvidenceHaveExplicitFallbacks()
    throws Exception {
    var plan = service.preset("adaptive-rounds", LD);
    String dueId = plan.evidenceIds().get("taskId");
    String laterId = plan.evidenceIds().get("laterTaskId");
    assertFalse(
      plan
        .beforeRounds()
        .stream()
        .anyMatch(r -> r.task().id.equals(dueId))
    );
    List<Round> rounds = service.rounds(service.read(), "L_AND_D");
    Round due = rounds
      .stream()
      .filter(r -> r.task().id.equals(dueId))
      .findFirst()
      .orElseThrow();
    Round later = rounds
      .stream()
      .filter(r -> r.task().id.equals(laterId))
      .findFirst()
      .orElseThrow();
    assertTrue(rounds.indexOf(due) < rounds.indexOf(later));
    assertEquals("NOW", due.horizon());
    assertTrue(due.reasonCodes().contains("SCHEDULED_DUE"));
    assertEquals("LATER", later.horizon());
    mvc
      .perform(get("/api/patients/" + LD + "/sensor-history"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.samples.length()").value(0))
      .andExpect(jsonPath("$.movements.length()").value(0));
    Store row = repo.findById("demo").orElseThrow();
    State state = json.readValue(row.payload, State.class);
    state.samples.removeIf(x -> x.patientId().equals(ICU));
    state.movements.removeIf(m -> m.patientId.equals(ICU));
    state.devices.removeIf(
      d -> d.patientId.equals(ICU) && !d.bodyRegion.equals("BEDSIDE_MONITOR")
    );
    row.payload = json.writeValueAsString(state);
    repo.saveAndFlush(row);
    mvc
      .perform(get("/api/patients/" + ICU + "/sensor-history"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.devices[0].freshness").value("UNKNOWN"))
      .andExpect(jsonPath("$.samples.length()").value(0));
    State legacy = new State();
    legacy.vitals.add(
      new Vital(
        "legacy-id",
        LD,
        "HEART_RATE",
        80,
        "bpm",
        clock.instant(),
        clock.instant(),
        "SIMULATED_MONITOR",
        null,
        null,
        null
      )
    );
    assertEquals(
      List.of("legacy-id"),
      ClinicalViews.activity(legacy).get(0).measurementIds()
    );
  }
}
