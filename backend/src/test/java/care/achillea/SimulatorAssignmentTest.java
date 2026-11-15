package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:simulator-assign;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
    "app.demo.assign-patients=synthetic-icu-04, synthetic-icu-05,synthetic-icu-06,synthetic-icu-07",
  }
)
class SimulatorAssignmentTest {

  static final List<String> SIMULATOR = List.of(
    "synthetic-icu-01",
    "synthetic-icu-04",
    "synthetic-icu-05",
    "synthetic-icu-06",
    "synthetic-icu-07"
  );

  @Autowired
  CareService service;

  @Test
  void configuredCensusPatientsAreAssignedAndAcceptSimulatorData() {
    State s = service.read();
    for (String id : SIMULATOR) assertTrue(
      s.patients.stream().anyMatch(p -> p.id().equals(id)),
      id + " should be assigned to the demo nurse"
    );
    // L&D census patients stay unassigned.
    assertTrue(s.patients.stream().noneMatch(p -> p.id().equals("synthetic-ld-04")));

    Instant now = Instant.now();
    for (String id : SIMULATOR) {
      service.ingest(new Observation("hr-" + id, id, "HEART_RATE", 80, "bpm", now, "VALID"));
      assertEquals(2, service.ingestPosture(new PostureReading("p-" + id, id, 10.0, 8.0, now, null)).size());
    }
    Movement m = service.recordMovement(
      new MovementReading("turn-icu-05", "synthetic-icu-05", 0.0, 30.0, 0.0, 30.0, now, null, null)
    );
    assertEquals("COORDINATED_TURN_CANDIDATE", m.classification);

    // Idempotent: a second load does not add another assignment event.
    long assignments = service
      .read()
      .events.stream()
      .filter(e -> e.type().equals("patient.assigned") && e.patientId().equals("synthetic-icu-04"))
      .count();
    assertEquals(1, assignments);
  }
}
