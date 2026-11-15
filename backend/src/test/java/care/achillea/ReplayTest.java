package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:replay;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
    "app.replay.enabled=true",
    "app.replay.autostart=false",
    "app.replay.speed=10",
  }
)
@AutoConfigureMockMvc
@org.junit.jupiter.api.TestMethodOrder(org.junit.jupiter.api.MethodOrderer.OrderAnnotation.class)
@Import(ClinicalEngineTest.TimeConfig.class)
class ReplayTest {

  static final String ROBIN = "synthetic-icu-02";

  @Autowired CareService care;
  @Autowired ReplayEngine replay;
  @Autowired ClinicalEngineTest.MutableClock clock;
  @Autowired MockMvc mvc;
  @Autowired ObjectMapper json;

  private List<Vital> robin(String metric) {
    String session = ReplayEngine.PREFIX + replay.status().get("sessionId") + ":L0:";
    return care.read().vitals.stream().filter(v -> v.patientId().equals(ROBIN) && v.metric().equals(metric)
      && v.sourceEventId().startsWith(session))
      .sorted(java.util.Comparator.comparing(v -> ReplayEngine.recordedMinute(v.sourceEventId()))).toList();
  }

  private JsonNode get(String path) throws Exception {
    return json.readTree(mvc.perform(MvcRequest.get(path)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
  }

  static class MvcRequest {
    static org.springframework.test.web.servlet.RequestBuilder get(String p) {
      return org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(p);
    }
  }

  @Test
  @org.junit.jupiter.api.Order(1)
  void replayAdvancesDetectsTrendAndFlowsIntoHandoff() throws Exception {
    replay.control("restart", null, null); // fresh session
    assertEquals("PLAYING", replay.status().get("state"));
    // 30 real seconds at 10x = 300 recorded minutes: Robin's first readings, no trend yet
    replay.advance(30);
    int hr = robin("HEART_RATE").size();
    assertTrue(hr >= 5, "readings advance: " + hr);
    assertEquals(84.0, robin("HEART_RATE").get(0).value(), "recorded value kept verbatim");
    assertTrue(ShiftContext.alerts(care.read(), ROBIN).isEmpty());
    // pause holds the clock
    replay.control("pause", null, null);
    replay.advance(30);
    assertEquals(hr, robin("HEART_RATE").size());
    replay.control("resume", null, null);
    // advance through the sustained rise (recorded minutes 180..300)
    for (int i = 0; i < 6; i++) { clock.advance(10); replay.advance(10); }
    List<Map<String, Object>> alerts = ShiftContext.alerts(care.read(), ROBIN);
    assertEquals(1, alerts.size(), "exactly one deduplicated alert");
    Map<String, Object> alert = alerts.get(0);
    assertEquals("FLAGGED", alert.get("state"));
    assertEquals(3, ((List<?>) alert.get("evidence")).size());
    String id = (String) alert.get("id");
    // more readings while it is open never duplicate it
    for (int i = 0; i < 3; i++) replay.advance(10);
    assertEquals(1, ShiftContext.alerts(care.read(), ROBIN).size());

    // acknowledge -> documentation gap, still unresolved, in the handoff priorities
    mvc.perform(post("/api/monitoring/alerts/" + id + "/acknowledge")).andExpect(status().isOk())
      .andExpect(jsonPath("$.state").value("ACKNOWLEDGED"))
      .andExpect(jsonPath("$.documentationGap").value(true));
    JsonNode ctx = get("/api/patients/" + ROBIN + "/handoff-context");
    JsonNode prompt = ctx.path("priorities").path("prompt");
    boolean gap = false;
    for (JsonNode n : prompt) gap |= "DOCUMENTATION_GAP".equals(n.path("kind").asText()) && id.equals(n.path("sourceId").asText());
    assertTrue(gap, "gap carried into next-shift priorities");
    assertTrue(ctx.path("activity").path("alerts").size() >= 1);
    assertTrue(ctx.path("activity").path("latestVitals").size() >= 4);
    assertTrue(ctx.path("trends").size() >= 4, "per-metric shift trends");
    assertTrue(ctx.path("coverage").path("readings").asInt() > 0);
    boolean noteGap = false;
    for (JsonNode m : ctx.path("missing")) noteGap |= "DOCUMENT".equals(m.path("action").asText()) && id.equals(m.path("sourceId").asText());
    assertTrue(noteGap, "missing follow-up note listed with a fix action");

    // linked follow-up documentation updates the same alert, which stays open until resolved
    String draft = json.readTree(mvc.perform(post("/api/chart/drafts").contentType(MediaType.APPLICATION_JSON)
      .content("{\"patientId\":\"" + ROBIN + "\",\"type\":\"CARE_NOTE\",\"text\":\"Bedside review of heart rate trend; provider notified.\",\"linkedTaskId\":\"" + id + "\"}"))
      .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("id").asText();
    mvc.perform(post("/api/chart/drafts/" + draft + "/confirm").contentType(MediaType.APPLICATION_JSON).content("{\"verified\":true}"))
      .andExpect(status().isOk());
    Map<String, Object> after = ShiftContext.alerts(care.read(), ROBIN).get(0);
    assertEquals("FOLLOW_UP_DOCUMENTED", after.get("state"));
    assertEquals(false, after.get("documentationGap"));

    // restart starts a new session but does not re-raise the still-open alert
    replay.control("restart", null, null);
    for (int i = 0; i < 12; i++) replay.advance(10);
    assertEquals(1, ShiftContext.alerts(care.read(), ROBIN).size());
  }

  @Test
  @org.junit.jupiter.api.Order(2)
  void loopsInsteadOfFreezing() {
    replay.control("restart", null, null);
    long before = care.read().vitals.size();
    for (int i = 0; i < 120; i++) replay.advance(1.0); // 1200 recorded minutes > recording length
    assertEquals("PLAYING", replay.status().get("state"));
    assertTrue(((Number) replay.status().get("loopIndex")).intValue() >= 1);
    assertTrue(care.read().vitals.size() > before);
  }
}
