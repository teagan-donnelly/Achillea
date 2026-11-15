package care.achillea;

import static care.achillea.Model.*;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:vital-series;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
@Import(ClinicalEngineTest.TimeConfig.class)
class VitalSeriesTest {

  static final String P = "synthetic-ld-01";
  static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");

  @Autowired
  CareService service;

  @Autowired
  ClinicalEngineTest.MutableClock clock;

  @Autowired
  MockMvc mvc;

  @BeforeEach
  void reset() {
    clock.value = ClinicalEngineTest.NOW;
    service.reset();
  }

  void rr(String event, int minutes, double value, String quality) {
    service.ingest(
      new Observation(event, P, "RESPIRATORY_RATE", value, "breaths/min", T0.plusSeconds(minutes * 60L), quality)
    );
  }

  long stored(String metric) {
    return service.read().vitals.stream().filter(v -> v.patientId().equals(P) && v.metric().equals(metric)).count();
  }

  @Test
  void fullStayIncludesStoredReadingsOlderThanDefaultWindow() throws Exception {
    rr("old-full-stay", 0, 14, "VALID");
    mvc.perform(get("/api/patients/" + P + "/vitals/series")
        .param("metric", "RESPIRATORY_RATE").param("fullStay", "true"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.from").value(T0.toString()))
      .andExpect(jsonPath("$.points[0].min").value(14.0));
  }

  @Test
  void eventCursorPreservesTimestampTies() throws Exception {
    var firstResult = mvc.perform(get("/api/events").param("patientId", P).param("limit", "1"))
      .andExpect(status().isOk()).andReturn();
    var json = new com.fasterxml.jackson.databind.ObjectMapper().readTree(firstResult.getResponse().getContentAsString());
    assertFalse(json.isEmpty());
    String timestamp = json.get(0).get("timestamp").asText();
    String id = json.get(0).get("id").asText();
    var nextResult = mvc.perform(get("/api/events").param("patientId", P).param("limit", "500")
        .param("before", timestamp).param("beforeId", id))
      .andExpect(status().isOk()).andReturn();
    var next = new com.fasterxml.jackson.databind.ObjectMapper().readTree(nextResult.getResponse().getContentAsString());
    assertFalse(next.isEmpty());
    for (var event : next) {
      Instant at = Instant.parse(event.get("timestamp").asText());
      assertTrue(at.isBefore(Instant.parse(timestamp)) ||
        (at.equals(Instant.parse(timestamp)) && event.get("id").asText().compareTo(id) < 0));
    }
  }

  @Test
  void bucketsValidReadingsAndOmitsEmptyBuckets() throws Exception {
    rr("rr-1", 0, 14, "VALID");
    rr("rr-2", 5, 16, "VALID");
    rr("rr-3", 20, 20, "VALID");
    rr("rr-4", 61, 40, "SUSPECTED_ARTIFACT"); // the only reading in bucket 1 -> bucket omitted
    rr("rr-5", 125, 22, "VALID");
    rr("rr-6", 400, 18, "VALID"); // outside the window, still counted in coverage
    mvc
      .perform(
        get("/api/patients/" + P + "/vitals/series")
          .param("metric", "RESPIRATORY_RATE")
          .param("from", T0.toString())
          .param("to", T0.plusSeconds(3 * 3600).toString())
          .param("bucketMinutes", "60")
      )
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.patientId").value(P))
      .andExpect(jsonPath("$.metric").value("RESPIRATORY_RATE"))
      .andExpect(jsonPath("$.unit").value("breaths/min"))
      .andExpect(jsonPath("$.bucketMinutes").value(60))
      .andExpect(jsonPath("$.from").value(T0.toString()))
      .andExpect(jsonPath("$.points.length()").value(2))
      .andExpect(jsonPath("$.points[0].t").value(T0.toString()))
      .andExpect(jsonPath("$.points[0].value").value(16.67))
      .andExpect(jsonPath("$.points[0].min").value(14.0))
      .andExpect(jsonPath("$.points[0].max").value(20.0))
      .andExpect(jsonPath("$.points[0].count").value(3))
      .andExpect(jsonPath("$.points[1].t").value(T0.plusSeconds(7200).toString()))
      .andExpect(jsonPath("$.points[1].value").value(22.0))
      .andExpect(jsonPath("$.points[1].count").value(1))
      .andExpect(jsonPath("$.firstObservedAt").value(T0.toString()))
      .andExpect(jsonPath("$.totalReadings").value((int) stored("RESPIRATORY_RATE")));
  }

  @Test
  void defaultsToLast24HoursWithAbout96Buckets() throws Exception {
    Instant now = ClinicalEngineTest.NOW;
    mvc
      .perform(get("/api/patients/" + P + "/vitals/series").param("metric", "HEART_RATE"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.to").value(now.toString()))
      .andExpect(jsonPath("$.from").value(now.minusSeconds(86400).toString()))
      .andExpect(jsonPath("$.bucketMinutes").value(15))
      .andExpect(jsonPath("$.totalReadings").value((int) stored("HEART_RATE")));
    // Seven days -> ceil(10080 / 96) = 105 minute buckets.
    mvc
      .perform(
        get("/api/patients/" + P + "/vitals/series")
          .param("metric", "HEART_RATE")
          .param("from", now.minusSeconds(7 * 86400).toString())
          .param("to", now.toString())
      )
      .andExpect(jsonPath("$.bucketMinutes").value(105));
  }

  @Test
  void clampsBucketSizeAndReportsEmptySeriesHonestly() throws Exception {
    mvc
      .perform(get("/api/patients/" + P + "/vitals/series").param("metric", "TEMPERATURE").param("bucketMinutes", "0"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.bucketMinutes").value(1))
      .andExpect(jsonPath("$.unit").value(stored("TEMPERATURE") == 0 ? "" : "°C"));
    mvc
      .perform(get("/api/patients/" + P + "/vitals/series").param("metric", "NOT_A_METRIC").param("bucketMinutes", "999999"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.bucketMinutes").value(10080))
      .andExpect(jsonPath("$.unit").value(""))
      .andExpect(jsonPath("$.points.length()").value(0))
      .andExpect(jsonPath("$.firstObservedAt").value(nullValue()))
      .andExpect(jsonPath("$.lastObservedAt").value(nullValue()))
      .andExpect(jsonPath("$.totalReadings").value(0));
  }

  @Test
  void rejectsBadRequestsAndUnassignedPatients() throws Exception {
    mvc.perform(get("/api/patients/" + P + "/vitals/series")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/patients/" + P + "/vitals/series").param("metric", " ")).andExpect(status().isBadRequest());
    mvc
      .perform(
        get("/api/patients/" + P + "/vitals/series")
          .param("metric", "HEART_RATE")
          .param("from", "2026-11-14T12:00:00Z")
          .param("to", "2026-11-14T11:00:00Z")
      )
      .andExpect(status().isBadRequest());
    mvc
      .perform(get("/api/patients/" + P + "/vitals/series").param("metric", "HEART_RATE").param("from", "yesterday"))
      .andExpect(status().isBadRequest());
    mvc
      .perform(get("/api/patients/synthetic-ld-04/vitals/series").param("metric", "HEART_RATE"))
      .andExpect(status().isNotFound());
    mvc
      .perform(get("/api/patients/synthetic-ld-04/orientation/series").param("region", "PELVIS"))
      .andExpect(status().isNotFound());
    mvc
      .perform(get("/api/patients/synthetic-icu-01/orientation/series").param("region", "HEAD"))
      .andExpect(status().isBadRequest());
  }

  @Test
  void orientationSeriesUsesRollDegreesByCaptureTime() throws Exception {
    String icu = "synthetic-icu-01";
    State s = service.read();
    long total = s.samples.stream().filter(x -> x.patientId().equals(icu) && x.bodyRegion().equals("UPPER_TORSO")).count();
    assertTrue(total > 0);
    OrientationSample valid = s.samples
      .stream()
      .filter(x -> x.patientId().equals(icu) && x.bodyRegion().equals("UPPER_TORSO") && x.quality().equals("SIMULATED_GOOD"))
      .findFirst()
      .orElseThrow();
    mvc
      .perform(
        get("/api/patients/" + icu + "/orientation/series")
          .param("region", "UPPER_TORSO")
          .param("from", valid.capturedAt().toString())
          .param("to", valid.capturedAt().toString())
      )
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.metric").value("UPPER_TORSO"))
      .andExpect(jsonPath("$.unit").value("°"))
      .andExpect(jsonPath("$.bucketMinutes").value(1))
      .andExpect(jsonPath("$.points[0].t").value(valid.capturedAt().toString()))
      .andExpect(jsonPath("$.points[0].value").value(Math.round(valid.rollDegrees() * 100) / 100.0))
      .andExpect(jsonPath("$.totalReadings").value((int) total));
  }

  @Test
  void bucketingIsAlignedToFromAndAveragesPerBucket() {
    Instant from = Instant.parse("2026-01-01T00:07:00Z");
    var readings = java.util.List.of(
      new HistoryController.Reading(from.plusSeconds(60), 10, true, "bpm"),
      new HistoryController.Reading(from.plusSeconds(9 * 60), 20, true, "bpm"),
      new HistoryController.Reading(from.plusSeconds(10 * 60), 30, true, "bpm"),
      new HistoryController.Reading(from.plusSeconds(11 * 60), Double.NaN, true, "bpm")
    );
    var out = HistoryController.series("p", "HEART_RATE", null, readings, from, from.plusSeconds(3600), 10, from);
    assertEquals(2, out.points().size());
    assertEquals(from, out.points().get(0).t());
    assertEquals(15.0, out.points().get(0).value());
    assertEquals(from.plusSeconds(600), out.points().get(1).t());
    assertEquals(1, out.points().get(1).count());
    assertEquals(4, out.totalReadings());
  }
}
