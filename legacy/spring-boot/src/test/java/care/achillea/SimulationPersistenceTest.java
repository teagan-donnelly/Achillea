package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = { "app.monitor.enabled=false" })
@AutoConfigureMockMvc
class SimulationPersistenceTest extends PostgresTestSupport {

  @Autowired
  CareService care;

  @Autowired
  RelationalStore store;

  @Autowired
  SimulationService simulation;

  @Autowired
  MockMvc mvc;

  static final String ENCOUNTER = "encounter-synthetic-icu-01",
    SOURCE = "simulator-001";

  @BeforeEach
  void reset() {
    care.reset();
    simulation.bind(SOURCE, ENCOUNTER);
  }

  SimulationService.Axes axes(double degrees) {
    double r = Math.toRadians(degrees);
    return new SimulationService.Axes(0d, Math.sin(r), Math.cos(r), 0d, 0d, 0d);
  }

  SimulationService.Packet packet(
    String id,
    Instant time,
    Double chest,
    Double pelvis
  ) {
    return new SimulationService.Packet(
      id,
      time,
      null,
      chest == null ? null : axes(chest),
      pelvis == null ? null : axes(pelvis),
      null,
      null
    );
  }

  SimulationService.Batch batch(
    String run,
    SimulationService.Packet... samples
  ) {
    return new SimulationService.Batch(
      1,
      ENCOUNTER,
      SOURCE,
      run,
      600d,
      List.of(samples)
    );
  }

  @Test
  void migrationsAreRelationalAndRejectDanglingEvidence() {
    assertEquals(
      0,
      store
        .jdbc()
        .queryForObject(
          "select count(*) from information_schema.tables where table_schema=current_schema() and table_name='store'",
          Integer.class
        )
    );
    assertTrue(
      store
        .jdbc()
        .queryForObject("select count(*) from patients", Integer.class) > 0
    );
    assertThrows(DataIntegrityViolationException.class, () ->
      store
        .jdbc()
        .update("insert into care_assignments values('missing','nurse-demo')")
    );
  }

  @Test
  void acceleratedSourceTimeRawValuesAndReceiptTimeRemainDistinct() {
    Instant simulated = Instant.parse("2040-01-01T00:00:00Z");
    var ack = simulation.ingest(
      batch(
        "run-a",
        packet("e1", simulated, 0d, 0d),
        packet("e2", simulated.plusSeconds(2), 40d, 40d)
      ),
      250
    );
    assertEquals(2, ack.accepted());
    assertEquals(
      4,
      store
        .jdbc()
        .queryForObject("select count(*) from raw_imu_samples", Integer.class)
    );
    String movement = ack.results().getLast().movementId();
    assertNotNull(movement);
    State s = care.scoped(null, "synthetic-icu-01", true, null);
    Movement m = s.movements
      .stream()
      .filter(x -> x.id.equals(movement))
      .findFirst()
      .orElseThrow();
    assertEquals("COORDINATED_TURN_CANDIDATE", m.classification);
    assertEquals("UNREVIEWED", m.verificationStatus);
    assertFalse(m.receivedAt.equals(m.capturedAt));
    assertEquals(
      "OPEN",
      s.tasks
        .stream()
        .filter(t -> t.id.equals("task-3"))
        .findFirst()
        .orElseThrow()
        .status
    );
    assertTrue(
      s.devices
        .stream()
        .filter(d -> d.timeDomain.equals("SIMULATION"))
        .allMatch(d -> d.freshness.equals("FRESH"))
    );
    assertEquals(
      "synthetic-icu-01",
      simulation.history(ENCOUNTER, SOURCE, 0, 1).get("patientId")
    );
  }

  @Test
  void repeatedBatchesAndConflictingEventIdsAreAtomic() {
    var first = batch(
      "run-a",
      packet("e1", Instant.parse("2026-01-01T00:00:00Z"), 0d, 0d)
    );
    simulation.ingest(first, 250);
    assertEquals(1, simulation.ingest(first, 250).duplicates());
    assertEquals(
      2,
      store
        .jdbc()
        .queryForObject("select count(*) from raw_imu_samples", Integer.class)
    );
    var conflict = batch(
      "run-a",
      packet("e2", Instant.parse("2026-01-01T00:00:01Z"), 2d, 2d),
      packet("e1", Instant.parse("2026-01-01T00:00:00Z"), 20d, 0d)
    );
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> simulation.ingest(conflict, 250)
    );
    assertEquals(
      1,
      store
        .jdbc()
        .queryForObject(
          "select count(*) from ingestion_receipts",
          Integer.class
        )
    );
  }

  @Test
  void patientsAndRunResetsHaveIndependentDurableState() {
    simulation.ingest(
      batch(
        "run-a",
        packet("e1", Instant.parse("2026-01-01T00:00:00Z"), 0d, 0d)
      ),
      250
    );
    String second = "encounter-synthetic-icu-02";
    simulation.bind(SOURCE, second);
    var other = new SimulationService.Batch(
      1,
      second,
      SOURCE,
      "run-a",
      60d,
      List.of(packet("e1", Instant.parse("2026-01-01T00:00:00Z"), 80d, 80d))
    );
    assertNull(simulation.ingest(other, 250).results().getFirst().movementId());
    assertNull(
      simulation
        .ingest(
          batch(
            "run-b",
            packet("e1", Instant.parse("2020-01-01T00:00:00Z"), 80d, 80d)
          ),
          250
        )
        .results()
        .getFirst()
        .movementId()
    );
    assertEquals(
      3,
      store
        .jdbc()
        .queryForObject(
          "select count(*) from simulation_streams",
          Integer.class
        )
    );
  }

  @Test
  void outOfOrderAndMissingRegionsRemainTraceable() {
    Instant time = Instant.parse("2026-01-01T00:00:00Z");
    simulation.ingest(
      batch(
        "r",
        packet("e1", time, 0d, 0d),
        packet("e2", time.plusSeconds(2), 40d, null)
      ),
      250
    );
    var late = simulation.ingest(
      batch("r", packet("e0", time.minusSeconds(1), 90d, 90d)),
      250
    );
    assertEquals("OUT_OF_ORDER", late.results().getFirst().status());
    assertNull(late.results().getFirst().movementId());
    assertEquals(
      "UNKNOWN",
      store
        .jdbc()
        .queryForObject(
          "select classification from movement_candidates where id like 'movement-%'",
          String.class
        )
    );
  }

  @Test
  void nanBadIdentityAndOversizedBatchesFailBeforeWrites() {
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () ->
        simulation.ingest(
          new SimulationService.Batch(
            1,
            "missing",
            SOURCE,
            "r",
            1d,
            List.of(packet("e", Instant.now(), 0d, 0d))
          ),
          250
        )
    );
    var bad = new SimulationService.Packet(
      "bad",
      Instant.now(),
      null,
      new SimulationService.Axes(Double.NaN, 0d, 1d, 0d, 0d, 0d),
      null,
      null,
      null
    );
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> simulation.ingest(batch("r", bad), 250)
    );
    assertThrows(
      org.springframework.web.server.ResponseStatusException.class,
      () -> simulation.ingest(batch("r", packet("e", Instant.now(), 0d, 0d)), 0)
    );
    assertEquals(
      0,
      store
        .jdbc()
        .queryForObject(
          "select count(*) from ingestion_receipts",
          Integer.class
        )
    );
  }

  @Test
  void endpointRequiresCredentialAndHasBodyLimit() throws Exception {
    mvc
      .perform(
        post("/api/integrations/simulation/v1/observations")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/integrations/simulation/v1/observations")
          .header("X-Simulation-Key", "test-only-integration-key")
          .contentType("application/json")
          .content("x".repeat(262145))
      )
      .andExpect(status().isPayloadTooLarge());
    mvc
      .perform(
        post("/api/integrations/simulation/v1/observations")
          .header("X-Simulation-Key", "test-only-integration-key")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isBadRequest());
    mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
  }

  @Test
  void concurrentTasksCannotConsumeTheSameMovement() throws Exception {
    State s = care.scenario("coordinated", "synthetic-icu-01");
    Movement m = s.movements.getLast();
    care.review(
      m.id,
      new Command(
        null,
        "Synthetic bedside verification",
        true,
        null,
        "CONFIRMED_CARE",
        null,
        null
      )
    );
    Task t = care.schedule(
      new CareService.ScheduleRequest(
        m.patientId,
        "Second prescribed review",
        Instant.now(),
        "ROUTINE"
      )
    );
    store
      .jdbc()
      .update(
        "update care_tasks set verification_required=true where id=?",
        t.id
      );
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      CountDownLatch start = new CountDownLatch(1);
      List<Future<Boolean>> futures = new ArrayList<>();
      for (String id : List.of("task-3", t.id))
        futures.add(
          pool.submit(() -> {
            start.await();
            try {
              care.taskCommand(
                id,
                "complete",
                new Command(null, null, true, m.id, null, null, null)
              );
              return true;
            } catch (
              org.springframework.web.server.ResponseStatusException
              | DataIntegrityViolationException conflict
            ) {
              return false;
            }
          })
        );
      start.countDown();
      int success = 0;
      for (var f : futures) if (f.get(15, TimeUnit.SECONDS)) success++;
      assertEquals(1, success);
      assertEquals(
        1,
        store
          .jdbc()
          .queryForObject(
            "select count(*) from movement_consumptions where movement_id=?",
            Integer.class,
            m.id
          )
      );
    } finally {
      pool.shutdownNow();
    }
  }
  @Test void timestampTiesAndDuplicatesWithinOneBatchArePreserved(){
    Instant time=Instant.parse("2026-01-01T00:00:00Z");var one=packet("same",time,0d,0d);var ack=simulation.ingest(batch("ties",one,one,packet("different",time,0d,0d)),250);
    assertEquals(2,ack.accepted());assertEquals(1,ack.duplicates());assertEquals("TIMESTAMP_TIE",ack.results().getLast().status());assertEquals(4,store.jdbc().queryForObject("select count(*) from raw_imu_samples",Integer.class));
  }
  @Test void explicitDisconnectionDoesNotInventZeroRegionSamples(){
    Instant time=Instant.parse("2026-01-01T00:00:00Z");simulation.ingest(batch("disconnection",packet("baseline",time,0d,0d)),250);
    var disconnected=new SimulationService.Packet("offline",time.plusSeconds(1),null,null,null,false,false);
    simulation.ingest(batch("disconnection",disconnected),250);
    assertEquals(2,store.jdbc().queryForObject("select count(*) from raw_imu_samples",Integer.class));
    assertEquals(2,store.jdbc().queryForObject("select count(*) from devices where time_domain='SIMULATION' and connection_state='DISCONNECTED'",Integer.class));
    assertEquals(0,store.jdbc().queryForObject("select count(*) from movement_candidates where id like 'movement-%'",Integer.class));
  }
  @Test void taskChartAndHistoryRollbackTogetherOnDatabaseFailure(){
    int events=store.jdbc().queryForObject("select count(*) from activity_events",Integer.class),charts=store.jdbc().queryForObject("select count(*) from chart_entries",Integer.class);
    store.jdbc().execute("create function reject_completion_test() returns trigger language plpgsql as $$ begin raise exception 'Injected transactional failure' using errcode='23514'; end $$");
    store.jdbc().execute("create trigger reject_completion_test before insert on chart_entries for each row when(new.type='TASK_COMPLETION') execute function reject_completion_test()");
    try{assertThrows(DataIntegrityViolationException.class,()->care.taskCommand("task-1","complete",new Command(null,null,true,null,null,null,null)));assertEquals("OPEN",store.jdbc().queryForObject("select status from care_tasks where id='task-1'",String.class));assertEquals(events,store.jdbc().queryForObject("select count(*) from activity_events",Integer.class));assertEquals(charts,store.jdbc().queryForObject("select count(*) from chart_entries",Integer.class));}finally{store.jdbc().execute("drop trigger reject_completion_test on chart_entries");store.jdbc().execute("drop function reject_completion_test()");}
  }
  @Test void concurrentReplayProducesOneReceipt()throws Exception{
    var data=batch("race",packet("one",Instant.parse("2026-01-01T00:00:00Z"),0d,0d));ExecutorService pool=Executors.newFixedThreadPool(2);try{CountDownLatch start=new CountDownLatch(1);List<Future<SimulationService.Ack>> jobs=new ArrayList<>();for(int i=0;i<2;i++)jobs.add(pool.submit(()->{start.await();return simulation.ingest(data,250);}));start.countDown();int accepted=0,duplicates=0;for(var job:jobs){var ack=job.get(15,TimeUnit.SECONDS);accepted+=ack.accepted();duplicates+=ack.duplicates();}assertEquals(1,accepted);assertEquals(1,duplicates);assertEquals(1,store.jdbc().queryForObject("select count(*) from ingestion_receipts",Integer.class));}finally{pool.shutdownNow();}
  }

}
