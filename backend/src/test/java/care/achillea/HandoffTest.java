package care.achillea;

import static care.achillea.Model.*;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Path;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:handoffs;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
@Import(ClinicalEngineTest.TimeConfig.class)
class HandoffTest {

  static final String P = "synthetic-ld-01";

  @Autowired
  CareService service;

  @Autowired
  HandoffService handoffs;

  @Autowired
  RelationalStore store;

  @Autowired
  JdbcTemplate jdbc;

  @Autowired
  ClinicalEngineTest.MutableClock clock;

  @Autowired
  MockMvc mvc;

  @Autowired
  ObjectMapper json;

  @TempDir
  Path temporary;

  @BeforeEach
  void reset() {
    clock.value = ClinicalEngineTest.NOW;
    service.reset();
  }

  ResultActions post(String path, String body) throws Exception {
    return mvc.perform(
      org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)
    );
  }

  ResultActions patch(String path, String body) throws Exception {
    return mvc.perform(
      org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch(path)
        .contentType(MediaType.APPLICATION_JSON)
        .content(body)
    );
  }

  String create(String body) throws Exception {
    String out = post("/api/handoffs", body).andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
    return json.readTree(out).get("id").asText();
  }

  @Test
  void shiftBoundaries() {
    ZoneId utc = ZoneOffset.UTC;
    assertArrayEquals(new String[] { "2026-11-14", "Day" }, HandoffService.shiftOf(Instant.parse("2026-11-14T07:00:00Z"), utc));
    assertArrayEquals(new String[] { "2026-11-14", "Day" }, HandoffService.shiftOf(Instant.parse("2026-11-14T18:59:59Z"), utc));
    assertArrayEquals(new String[] { "2026-11-14", "Night" }, HandoffService.shiftOf(Instant.parse("2026-11-14T19:00:00Z"), utc));
    assertArrayEquals(new String[] { "2026-11-13", "Night" }, HandoffService.shiftOf(Instant.parse("2026-11-14T06:59:00Z"), utc));
  }

  @Test
  void createDefaultsToCurrentShiftAndRejectsDuplicateOpenHandoff() throws Exception {
    String[] shift = HandoffService.shiftOf(ClinicalEngineTest.NOW, ZoneId.systemDefault());
    post("/api/handoffs", "{\"patientId\":\"" + P + "\",\"sections\":{\"currentConcerns\":\"Pain 4/10 after ambulation\"}}")
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.status").value("DRAFT"))
      .andExpect(jsonPath("$.version").value(1))
      .andExpect(jsonPath("$.senderId").value("nurse-demo"))
      .andExpect(jsonPath("$.receiverId").value(nullValue()))
      .andExpect(jsonPath("$.shiftDate").value(shift[0]))
      .andExpect(jsonPath("$.shiftLabel").value(shift[1]))
      .andExpect(jsonPath("$.patientName").value("Maya Rowan"))
      .andExpect(jsonPath("$.unit").value("L_AND_D"))
      .andExpect(jsonPath("$.sections.currentConcerns").value("Pain 4/10 after ambulation"))
      .andExpect(jsonPath("$.sections.nextShiftPriorities").value(""))
      .andExpect(jsonPath("$.createdAt").value(ClinicalEngineTest.NOW.toString()))
      .andExpect(jsonPath("$.readyAt").value(nullValue()));
    post("/api/handoffs", "{\"patientId\":\"" + P + "\"}")
      .andExpect(status().isConflict())
      .andExpect(r -> assertTrue(r.getResolvedException().getMessage().contains("unacknowledged handoff already exists")));
    // A different shift for the same patient is allowed.
    post("/api/handoffs", "{\"patientId\":\"" + P + "\",\"shiftLabel\":\"Night\",\"shiftDate\":\"2026-11-01\",\"receiverId\":\"nurse-next\"}")
      .andExpect(status().isCreated())
      .andExpect(jsonPath("$.receiverId").value("nurse-next"))
      .andExpect(jsonPath("$.shiftDate").value("2026-11-01"));
    assertTrue(service.read().events.stream().anyMatch(e -> e.type().equals("handoff.created") && P.equals(e.patientId()) && e.source().equals("nurse-demo")));
  }

  @Test
  void validationAndNotFound() throws Exception {
    post("/api/handoffs", "{}").andExpect(status().isBadRequest());
    post("/api/handoffs", "{\"patientId\":\"synthetic-ld-04\"}").andExpect(status().isNotFound());
    post("/api/handoffs", "{\"patientId\":\"nope\"}").andExpect(status().isNotFound());
    post("/api/handoffs", "{\"patientId\":\"" + P + "\",\"shiftLabel\":\"Evening\"}").andExpect(status().isBadRequest());
    post("/api/handoffs", "{\"patientId\":\"" + P + "\",\"shiftDate\":\"11/14/2026\"}").andExpect(status().isBadRequest());
    String big = "x".repeat(5001);
    post("/api/handoffs", "{\"patientId\":\"" + P + "\",\"sections\":{\"additionalObservations\":\"" + big + "\"}}").andExpect(status().isBadRequest());
    assertTrue(service.read().handoffs.isEmpty());
    String id = create("{\"patientId\":\"" + P + "\",\"sections\":{\"currentConcerns\":\"" + "y".repeat(5000) + "\"}}");
    patch("/api/handoffs/" + id, "{\"sections\":{\"changesDuringShift\":\"" + big + "\"}}").andExpect(status().isBadRequest());
    mvc.perform(get("/api/handoffs/missing")).andExpect(status().isNotFound());
    patch("/api/handoffs/missing", "{}").andExpect(status().isNotFound());
    post("/api/handoffs/missing/ready", "").andExpect(status().isNotFound());
    mvc.perform(get("/api/handoffs").param("patientId", "synthetic-ld-04")).andExpect(status().isNotFound());
    mvc.perform(get("/api/handoffs").param("status", "DONE")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/handoffs").param("unit", "ER")).andExpect(status().isBadRequest());
  }

  @Test
  void editsAppendVersionsAndMergeSections() throws Exception {
    String id = create("{\"patientId\":\"" + P + "\"}");
    clock.advance(60);
    patch("/api/handoffs/" + id, "{\"sections\":{\"currentConcerns\":\"Fundal check pending\"}}")
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.version").value(2));
    clock.advance(60);
    patch("/api/handoffs/" + id, "{\"sections\":{\"nextShiftPriorities\":\"Recheck at 16:00\"},\"receiverId\":\"nurse-night\"}")
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.version").value(3))
      .andExpect(jsonPath("$.receiverId").value("nurse-night"))
      .andExpect(jsonPath("$.sections.currentConcerns").value("Fundal check pending"))
      .andExpect(jsonPath("$.sections.nextShiftPriorities").value("Recheck at 16:00"))
      .andExpect(jsonPath("$.updatedAt").value(ClinicalEngineTest.NOW.plusSeconds(120).toString()));
    mvc
      .perform(get("/api/handoffs/" + id))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.handoff.version").value(3))
      .andExpect(jsonPath("$.handoff.room").value("201"))
      .andExpect(jsonPath("$.versions.length()").value(3))
      .andExpect(jsonPath("$.versions[0].version").value(3))
      .andExpect(jsonPath("$.versions[0].handoffId").value(id))
      .andExpect(jsonPath("$.versions[0].savedBy").value("nurse-demo"))
      .andExpect(jsonPath("$.versions[0].status").value("DRAFT"))
      .andExpect(jsonPath("$.versions[1].sections.currentConcerns").value("Fundal check pending"))
      .andExpect(jsonPath("$.versions[1].sections.nextShiftPriorities").value(""))
      .andExpect(jsonPath("$.versions[2].version").value(1))
      .andExpect(jsonPath("$.versions[2].sections.currentConcerns").value(""))
      .andExpect(jsonPath("$.versions[2].savedAt").value(ClinicalEngineTest.NOW.toString()));
    assertEquals(2, service.read().events.stream().filter(e -> e.type().equals("handoff.updated")).count());
  }

  @Test
  void lifecycleRequiresOrderAndExplicitVerifiedAcknowledgment() throws Exception {
    String id = create("{\"patientId\":\"" + P + "\"}");
    String base = "/api/handoffs/" + id;
    post(base + "/review", "").andExpect(status().isConflict());
    post(base + "/acknowledge", "{\"verified\":true}").andExpect(status().isConflict());
    post(base + "/ready", "").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("READY")).andExpect(jsonPath("$.readyAt").exists());
    post(base + "/ready", "").andExpect(status().isConflict());
    patch(base, "{\"sections\":{\"currentConcerns\":\"late edit\"}}")
      .andExpect(status().isConflict())
      .andExpect(r -> assertTrue(r.getResolvedException().getMessage().contains("only DRAFT")));
    // Opening never changes status.
    mvc.perform(get(base)).andExpect(jsonPath("$.handoff.status").value("READY"));
    mvc.perform(get("/api/handoffs")).andExpect(jsonPath("$[0].status").value("READY"));
    post(base + "/review", "").andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REVIEWED")).andExpect(jsonPath("$.reviewedBy").value("nurse-demo"));
    post(base + "/acknowledge", "").andExpect(status().isBadRequest());
    post(base + "/acknowledge", "{}").andExpect(status().isBadRequest());
    post(base + "/acknowledge", "{\"verified\":false}").andExpect(status().isBadRequest());
    post(base + "/acknowledge", "{\"verified\":\"true\"}").andExpect(status().isBadRequest());
    mvc.perform(get(base)).andExpect(jsonPath("$.handoff.status").value("REVIEWED"));
    post(base + "/acknowledge", "{\"verified\":true}")
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.status").value("ACKNOWLEDGED"))
      .andExpect(jsonPath("$.acknowledgedBy").value("nurse-demo"))
      .andExpect(jsonPath("$.acknowledgedAt").value(ClinicalEngineTest.NOW.toString()))
      .andExpect(jsonPath("$.version").value(1));
    post(base + "/acknowledge", "{\"verified\":true}").andExpect(status().isConflict());
    mvc.perform(get(base)).andExpect(jsonPath("$.versions.length()").value(1));
    for (String type : new String[] { "handoff.created", "handoff.ready", "handoff.reviewed", "handoff.acknowledged" }) assertEquals(
      1,
      service.read().events.stream().filter(e -> e.type().equals(type) && P.equals(e.patientId())).count(),
      type
    );
    // Once acknowledged, the same shift can start a new handoff.
    create("{\"patientId\":\"" + P + "\"}");
  }

  @Test
  void listFiltersAndSortsNewestFirst() throws Exception {
    String a = create("{\"patientId\":\"" + P + "\"}");
    clock.advance(30);
    String b = create("{\"patientId\":\"synthetic-icu-01\"}");
    clock.advance(30);
    post("/api/handoffs/" + a + "/ready", "").andExpect(status().isOk());
    mvc
      .perform(get("/api/handoffs"))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.length()").value(2))
      .andExpect(jsonPath("$[0].id").value(a))
      .andExpect(jsonPath("$[1].id").value(b))
      .andExpect(jsonPath("$[1].patientName").value("Alex Linden"))
      .andExpect(jsonPath("$[1].unit").value("ICU"));
    mvc.perform(get("/api/handoffs").param("unit", "ICU")).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(b));
    mvc.perform(get("/api/handoffs").param("status", "READY")).andExpect(jsonPath("$.length()").value(1)).andExpect(jsonPath("$[0].id").value(a));
    mvc.perform(get("/api/handoffs").param("patientId", "synthetic-icu-01")).andExpect(jsonPath("$.length()").value(1));
    // Existing payloads stay compatible; workspace omits version history.
    mvc.perform(get("/api/state")).andExpect(jsonPath("$.handoffs.length()").value(2)).andExpect(jsonPath("$.patients").isArray());
    mvc.perform(get("/api/workspace?unit=ICU")).andExpect(jsonPath("$.handoffs.length()").value(1)).andExpect(jsonPath("$.handoffVersions.length()").value(0));
  }

  @Test
  void persistsThroughRelationalStoreAndResetClears() throws Exception {
    String id = create("{\"patientId\":\"" + P + "\",\"sections\":{\"outstandingFollowUp\":\"Lab result pending\"}}");
    patch("/api/handoffs/" + id, "{\"sections\":{\"additionalObservations\":\"Family at bedside\"}}").andExpect(status().isOk());
    assertEquals(1, jdbc.queryForObject("select count(*) from handoffs", Integer.class));
    assertEquals(2, jdbc.queryForObject("select count(*) from handoff_versions", Integer.class));
    assertEquals("Lab result pending", jdbc.queryForObject("select section_outstanding_follow_up from handoffs", String.class));
    State reloaded = store.load().orElseThrow();
    Handoff h = reloaded.handoffs.getFirst();
    assertEquals(id, h.id);
    assertEquals(2, h.version);
    assertEquals("Family at bedside", h.sectionAdditionalObservations);
    assertEquals(ClinicalEngineTest.NOW, h.createdAt);
    assertEquals(2, reloaded.handoffVersions.size());
    service.reset();
    assertEquals(0, jdbc.queryForObject("select count(*) from handoffs", Integer.class));
    assertEquals(0, jdbc.queryForObject("select count(*) from handoff_versions", Integer.class));
  }

  @Test
  void handoffSurvivesApplicationRestart() {
    String database = temporary.resolve("handoff").toAbsolutePath().toString().replace('\\', '/');
    String id;
    try (ConfigurableApplicationContext first = start(database)) {
      CareService care = first.getBean(CareService.class);
      HandoffService service = first.getBean(HandoffService.class);
      care.reset();
      id = (String) service
        .create(new HandoffService.CreateRequest(P, new HandoffSections("Concern", null, null, null, null, null), "Day", "2026-11-14", null))
        .get("id");
      service.update(id, new HandoffService.UpdateRequest(new HandoffSections(null, "BP trend reviewed", null, null, null, null), "nurse-next"));
      service.transition(id, "ready", null);
    }
    try (ConfigurableApplicationContext second = start(database)) {
      var detail = second.getBean(HandoffService.class).detail(id);
      @SuppressWarnings("unchecked")
      var h = (java.util.Map<String, Object>) detail.get("handoff");
      assertEquals("READY", h.get("status"));
      assertEquals(2, h.get("version"));
      assertEquals("nurse-next", h.get("receiverId"));
      HandoffSections sections = (HandoffSections) h.get("sections");
      assertEquals("Concern", sections.currentConcerns());
      assertEquals("BP trend reviewed", sections.changesDuringShift());
      assertEquals(2, ((java.util.List<?>) detail.get("versions")).size());
    }
  }

  ConfigurableApplicationContext start(String database) {
    return new SpringApplicationBuilder(Application.class)
      .web(WebApplicationType.NONE)
      .run(
        "--spring.datasource.url=jdbc:h2:file:" + database,
        "--spring.datasource.username=sa",
        "--spring.datasource.password=",
        "--app.monitor.enabled=false",
        "--spring.main.banner-mode=off",
        "--logging.level.root=ERROR"
      );
  }

  @Test
  void handoffJsonRoundTripsThroughStateSnapshot() throws Exception {
    String id = create("{\"patientId\":\"" + P + "\",\"sections\":{\"currentConcerns\":\"A\"}}");
    JsonNode state = json.readTree(json.writeValueAsString(store.load().orElseThrow()));
    assertEquals("A", state.get("handoffs").get(0).get("sections").get("currentConcerns").asText());
    assertNull(state.get("handoffs").get(0).get("sectionCurrentConcerns"));
    State back = json.readValue(state.toString(), State.class);
    assertEquals(id, back.handoffs.getFirst().id);
    assertEquals("A", back.handoffs.getFirst().sectionCurrentConcerns);
  }
}
