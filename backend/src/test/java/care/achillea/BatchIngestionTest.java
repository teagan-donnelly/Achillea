package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:batch;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
    "app.demo.seed=simulator",
  }
)
class BatchIngestionTest {

  @Autowired
  CareService service;

  @Autowired
  LiveUpdates live;

  @Test
  void oneTickForAllPatientsIsOneSaveAndOneNotice() {
    service.reset();
    Instant now = Instant.now();
    List<Observation> vitals = new ArrayList<>();
    List<PostureReading> postures = new ArrayList<>();
    for (String[] p : DemoSeeder.SIMULATOR_PATIENTS) {
      String id = p[0];
      vitals.add(new Observation("b1-" + id + "-HR", id, "HEART_RATE", 88, "bpm", now, "VALID"));
      vitals.add(new Observation("b1-" + id + "-SPO2", id, "SPO2", 97, "%", now, "VALID"));
      postures.add(new PostureReading("b1-" + id, id, 12.0, 10.0, now, null));
    }
    vitals.add(new Observation("bad", "synthetic-ld-01", "HEART_RATE", 80, "bpm", now, "VALID")); // not assigned
    List<MovementReading> moves = List.of(
      new MovementReading("b1-turn", "synthetic-icu-05", 0.0, 35.0, 0.0, 33.0, now, null, null)
    );

    long revision = live.revision();
    BatchResult r = service.ingestBatch(new SimulatorBatch(vitals, postures, moves));

    assertEquals(16, r.accepted()); // 10 vitals + 5 postures + 1 movement
    assertEquals(1, r.rejected().size());
    assertEquals("observation", r.rejected().getFirst().type());
    assertEquals(404, r.rejected().getFirst().status());
    assertEquals(revision + 1, live.revision(), "a batch commits and notifies once");

    State s = service.read();
    assertEquals(10, s.vitals.size());
    assertEquals(12, s.samples.size()); // 5 postures x 2 regions + 2 movement samples
    assertEquals(1, s.movements.size());
    assertEquals(
      5,
      s.events.stream().filter(e -> e.type().equals("vital.received")).count(),
      "one vital audit event per patient per batch"
    );
    assertTrue(s.tasks.stream().anyMatch(t -> "b1-turn".equals(t.relatedMovementId)));

    // Re-sending the same tick is idempotent.
    BatchResult again = service.ingestBatch(new SimulatorBatch(vitals, postures, moves));
    assertEquals(16, again.accepted());
    assertEquals(10, service.read().vitals.size());
  }
}
