package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.time.Instant;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:orientation;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
  }
)
class OrientationIngestionTest {

  static final String ICU = "synthetic-icu-01";

  @Autowired
  CareService service;

  @Autowired
  JdbcTemplate jdbc;

  @BeforeEach
  void reset() {
    service.reset();
  }

  HttpStatus status(Runnable r) {
    ResponseStatusException e = assertThrows(ResponseStatusException.class, r::run);
    return HttpStatus.valueOf(e.getStatusCode().value());
  }

  @Test
  void dataIsStoredInRelationalTables() {
    State s = service.read();
    assertEquals(17, jdbc.queryForObject("select count(*) from patients", Integer.class));
    assertEquals(
      s.vitals.size(),
      jdbc.queryForObject(
        "select count(*) from vital_observations v join patients p on p.id=v.patient_id where p.nurse_id='nurse-demo'",
        Integer.class
      )
    );
    assertTrue(jdbc.queryForObject("select count(*) from care_tasks", Integer.class) > 0);
    assertTrue(jdbc.queryForObject("select count(*) from devices", Integer.class) > 0);
    assertEquals(1, jdbc.queryForObject("select count(*) from demo_metadata", Integer.class));
  }

  @Test
  void freeFormOrientationIsStoredAndIdempotent() {
    Instant at = Instant.now();
    OrientationReading r = new OrientationReading("sim-1-torso", ICU, "UPPER_TORSO", 27.5, at, null);
    OrientationSample o = service.ingestOrientation(r);
    assertEquals(27.5, o.rollDegrees());
    assertEquals("torso-sim-01", o.sensorId());
    assertEquals("SIMULATED_GOOD", o.quality());
    assertEquals(o, service.ingestOrientation(r));
    assertEquals(
      27.5,
      jdbc.queryForObject(
        "select roll_degrees from orientation_samples where id='sim-1-torso'",
        Double.class
      )
    );
    assertEquals(
      HttpStatus.CONFLICT,
      status(() ->
        service.ingestOrientation(
          new OrientationReading("sim-1-torso", ICU, "UPPER_TORSO", 10.0, at, null)
        )
      )
    );
    Device torso = service
      .read()
      .devices.stream()
      .filter(d -> d.id.equals("torso-sim-01"))
      .findFirst()
      .orElseThrow();
    assertEquals(at, torso.lastSampledAt);
    assertEquals("FRESH", torso.freshness);
  }

  @Test
  void postureWritesBothRegions() {
    Instant at = Instant.now();
    var samples = service.ingestPosture(new PostureReading("frame-1", ICU, -30.0, -25.0, at, null));
    assertEquals(2, samples.size());
    assertEquals("frame-1-UPPER_TORSO", samples.get(0).id());
    assertEquals(-25.0, samples.get(1).rollDegrees());
    assertEquals(samples, service.ingestPosture(new PostureReading("frame-1", ICU, -30.0, -25.0, at, null)));
  }

  @Test
  void invalidInputIsRejected() {
    Instant at = Instant.now();
    assertEquals(
      HttpStatus.BAD_REQUEST,
      status(() -> service.ingestOrientation(new OrientationReading("x", ICU, "HEAD", 1.0, at, null)))
    );
    assertEquals(
      HttpStatus.BAD_REQUEST,
      status(() -> service.ingestOrientation(new OrientationReading("x", ICU, "PELVIS", 200.0, at, null)))
    );
    assertEquals(
      HttpStatus.BAD_REQUEST,
      status(() -> service.ingestPosture(new PostureReading("x", ICU, null, null, at, null)))
    );
    assertEquals(
      HttpStatus.BAD_REQUEST,
      status(() ->
        service.ingestOrientation(new OrientationReading("x", ICU, "PELVIS", 1.0, at.plusSeconds(600), null))
      )
    );
    // L&D patients have no body sensors.
    assertEquals(
      HttpStatus.NOT_FOUND,
      status(() ->
        service.ingestOrientation(new OrientationReading("x", "synthetic-ld-01", "PELVIS", 1.0, at, null))
      )
    );
  }

  @Test
  void disconnectedSensorRejectsSamples() {
    service.scenario("disconnect", ICU);
    assertEquals(
      HttpStatus.CONFLICT,
      status(() ->
        service.ingestOrientation(new OrientationReading("p", ICU, "PELVIS", 5.0, Instant.now(), null))
      )
    );
  }

  @Test
  void freeFormTurnBecomesReviewCandidateNotCompletedCare() {
    int charts = service.read().charts.size();
    Movement m = service.recordMovement(
      new MovementReading("turn-1", ICU, 0.0, 32.0, 0.0, 28.0, Instant.now(), null, null)
    );
    assertEquals("COORDINATED_TURN_CANDIDATE", m.classification);
    assertEquals("UNREVIEWED", m.verificationStatus);
    assertTrue(m.reviewRequired);
    assertEquals(2, m.sampleIds.size());
    State s = service.read();
    assertTrue(s.tasks.stream().anyMatch(t -> "turn-1".equals(t.relatedMovementId)));
    assertEquals(charts, s.charts.size());
    assertEquals(
      2,
      jdbc.queryForObject(
        "select count(*) from movement_sample_links where owner_id='turn-1'",
        Integer.class
      )
    );

    // Before angles default to the settled position of the previous movement.
    Movement partial = service.recordMovement(
      new MovementReading("turn-2", ICU, null, 60.0, null, 30.0, Instant.now(), null, null)
    );
    assertEquals(32.0, partial.chestBefore);
    assertEquals(28.0, partial.pelvisBefore);
    assertEquals("PARTIAL_TORSO_MOVEMENT", partial.classification);

    Movement small = service.recordMovement(
      new MovementReading("turn-3", ICU, null, 64.0, null, 33.0, Instant.now(), null, null)
    );
    assertEquals("SMALL_ADJUSTMENT", small.classification);
    assertFalse(small.reviewRequired);
  }

  @Test
  void legacyJsonDatabaseIsImportedOnce() throws Exception {
    service.recordMovement(
      new MovementReading("legacy-turn", ICU, 0.0, 35.0, 0.0, 35.0, Instant.now(), null, null)
    );
    String payload = json.writeValueAsString(store.load().orElseThrow());
    int vitals = jdbc.queryForObject("select count(*) from vital_observations", Integer.class);
    // Simulate an old database: only the single-row JSON STORE table, empty relational tables.
    for (RelationalStore.Kind k : RelationalStore.KINDS.reversed()) jdbc.update("delete from " + k.table());
    jdbc.update("delete from demo_metadata");
    jdbc.execute("create table store (id varchar(255) primary key, payload clob, version bigint)");
    try {
      jdbc.update("insert into store (id, payload, version) values ('demo', ?, 0)", payload);
      RelationalStore fresh = new RelationalStore(jdbc, tx, json);
      State imported = fresh.load().orElseThrow();
      assertEquals(vitals, imported.vitals.size());
      assertEquals(vitals, jdbc.queryForObject("select count(*) from vital_observations", Integer.class));
      Movement m = imported.movements.stream().filter(x -> x.id.equals("legacy-turn")).findFirst().orElseThrow();
      assertEquals(2, m.sampleIds.size());
      assertEquals(1, jdbc.queryForObject("select count(*) from store", Integer.class)); // left untouched
    } finally {
      jdbc.execute("drop table store");
      store.load(); // resync the shared store's snapshot with the (re-imported) tables
    }
  }

  @Autowired
  RelationalStore store;

  @Autowired
  org.springframework.transaction.support.TransactionTemplate tx;

  @Autowired
  com.fasterxml.jackson.databind.ObjectMapper json;

  @Test
  void angleChangeWrapsAround() {
    assertEquals(20.0, CareService.angleChange(170, -170));
    assertEquals(-20.0, CareService.angleChange(-170, 170));
  }
}
