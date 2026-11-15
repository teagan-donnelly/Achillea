package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:simulator-seed;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
    "app.demo.seed=simulator",
  }
)
@AutoConfigureMockMvc
class SimulatorSeedTest {

  @Autowired
  CareService service;

  @Autowired
  MockMvc mvc;

  @Test
  void onlySimulatorPatientsWithNoSeededRecords() throws Exception {
    State s = service.reset();
    assertEquals(
      DemoSeeder.SIMULATOR_PATIENTS.stream().map(p -> p[0]).toList(),
      s.patients.stream().map(Patient::id).toList()
    );
    assertTrue(s.patients.stream().allMatch(p -> p.unit().equals("ICU") && p.repositionPlan()));
    assertEquals(15, s.devices.size()); // monitor + torso + pelvis each
    assertTrue(s.vitals.isEmpty());
    assertTrue(s.samples.isEmpty());
    assertTrue(s.movements.isEmpty());
    assertTrue(s.charts.isEmpty());
    assertTrue(s.tasks.isEmpty());
    assertTrue(s.events.isEmpty());
    assertTrue(service.census("L_AND_D").isEmpty());

    // Every view the UI polls works on an empty simulator database.
    for (String path : new String[] {
      "/api/workspace?unit=ICU",
      "/api/workspace?unit=L_AND_D",
      "/api/monitoring/updates?unit=ICU",
      "/api/rounds?unit=ICU",
      "/api/activity/summary?unit=ICU",
      "/api/patients/synthetic-icu-05/sensor-history",
      "/api/patients/synthetic-icu-05/posture",
    }) mvc.perform(get(path)).andExpect(status().isOk());
    mvc.perform(get("/api/patients").param("unit", "ICU")).andExpect(jsonPath("$.length()").value(5));

    // Simulator data flows in, and a turn creates the review task.
    Instant now = Instant.now();
    service.ingest(new Observation("v1", "synthetic-icu-06", "HEART_RATE", 101, "bpm", now, "VALID"));
    service.ingestPosture(new PostureReading("p1", "synthetic-icu-06", -20.0, -18.0, now, null));
    service.recordMovement(
      new MovementReading("t1", "synthetic-icu-06", 0.0, -30.0, 0.0, -28.0, now, null, null)
    );
    State after = service.read();
    assertEquals(1, after.vitals.size());
    assertEquals(4, after.samples.size());
    assertEquals(1, after.movements.size());
    assertTrue(after.tasks.stream().anyMatch(t -> "t1".equals(t.relatedMovementId)));
  }
}
