package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

class RestartPersistenceTest {

  @TempDir
  Path temporary;

  ConfigurableApplicationContext start(String database) {
    return new SpringApplicationBuilder(Application.class)
      .web(WebApplicationType.NONE)
      .run(
        "--spring.datasource.url=jdbc:h2:file:" + database,
        "--spring.datasource.username=sa",
        "--spring.datasource.password=",
        "--spring.jpa.hibernate.ddl-auto=update",
        "--app.monitor.enabled=false",
        "--spring.main.banner-mode=off",
        "--logging.level.root=ERROR",
        "--logging.level.org.springframework=ERROR",
        "--logging.level.org.springframework.boot=ERROR"
      );
  }

  @Test
  void confirmedChartTaskAndProvenanceSurviveApplicationRestart() {
    String database = temporary
      .resolve("restart")
      .toAbsolutePath()
      .toString()
      .replace('\\', '/');
    String chartId;
    String scheduledId;
    String movementId;
    int count;
    try (ConfigurableApplicationContext first = start(database)) {
      CareService service = first.getBean(CareService.class);
      service.reset();
      String vital = service
        .read()
        .vitals.stream()
        .filter(v -> v.patientId().equals("synthetic-ld-01"))
        .findFirst()
        .orElseThrow()
        .id();
      Chart c = service.draft(
        new Draft(
          "synthetic-ld-01",
          "OBSERVATION",
          "Persistence proof: synthetic bedside review",
          null,
          List.of(vital),
          null
        ),
        null,
        null
      );
      chartId = c.id;
      service.confirm(
        chartId,
        new Command(null, null, true, null, null, null, null)
      );
      service.taskCommand(
        "task-1",
        "acknowledge",
        new Command(null, null, null, null, null, null, null)
      );
      scheduledId = service
        .schedule(
          new CareService.ScheduleRequest(
            "synthetic-ld-01",
            "Persistent V3 review",
            java.time.Instant.now().plusSeconds(900),
            null
          )
        )
        .id;
      var preset = service.preset("repositioning", "synthetic-icu-01");
      movementId = preset.evidenceIds().get("movementId");
      service.scenario("monitor-disconnect", "synthetic-ld-01");
      count = service.read().charts.size();
    }
    try (ConfigurableApplicationContext second = start(database)) {
      CareService service = second.getBean(CareService.class);
      State state = service.read();
      Chart c = state.charts
        .stream()
        .filter(x -> x.id.equals(chartId))
        .findFirst()
        .orElseThrow();
      assertEquals("CONFIRMED", c.status);
      assertEquals("Persistence proof: synthetic bedside review", c.text);
      assertNotNull(c.confirmedAt);
      assertEquals(1, c.linkedVitalIds.size());
      assertTrue(c.provenance.contains("SIMULATED_MONITOR"));
      assertEquals(count, state.charts.size());
      assertEquals("ACKNOWLEDGED", service.task(state, "task-1").status);
      assertEquals(
        "Persistent V3 review",
        service.task(state, scheduledId).title
      );
      assertTrue(service.movement(state, movementId).reviewRequired);
      assertTrue(
        state.tasks
          .stream()
          .anyMatch(t -> movementId.equals(t.relatedMovementId))
      );
      assertTrue(
        state.tasks
          .stream()
          .anyMatch(t -> "monitor-synthetic-ld-01".equals(t.relatedDeviceId))
      );
      assertTrue(
        state.devices
          .stream()
          .anyMatch(
            d ->
              d.id.equals("monitor-synthetic-ld-01") &&
              d.connectionState.equals("DISCONNECTED") &&
              d.manualOverride
          )
      );
      assertTrue(
        state.events.stream().anyMatch(e -> e.type().equals("demo.preset"))
      );
      assertTrue(
        state.events.stream().anyMatch(e -> e.type().equals("chart.confirmed"))
      );
    }
  }

  @Test
  void repositioningPlanAndConfirmationSurviveRelationalRestart() {
    String database = temporary.resolve("turn-restart").toAbsolutePath().toString().replace('\\', '/');
    java.time.Instant due;
    String chartId;
    try (ConfigurableApplicationContext first = start(database)) {
      CareService service = first.getBean(CareService.class);
      service.reset(); service.repositioningDemo();
      State state = service.scenario("coordinated", "synthetic-icu-01");
      Movement movement = state.movements.getLast();
      State confirmed = service.confirmTurn("synthetic-icu-01", new Command(null, "Verified synthetic turn at bedside", true, movement.id, null, null, null));
      Repositioning.Plan plan = confirmed.repositioningPlans.stream().filter(p -> p.patientId.equals("synthetic-icu-01")).findFirst().orElseThrow();
      chartId = plan.confirmedChartId;
      due = service.repositioning("ICU").stream().filter(p -> p.patientId().equals(plan.patientId)).findFirst().orElseThrow().nextDueAt();
    }
    try (ConfigurableApplicationContext second = start(database)) {
      CareService service = second.getBean(CareService.class);
      var status = service.repositioning("ICU").stream().filter(p -> p.patientId().equals("synthetic-icu-01")).findFirst().orElseThrow();
      assertEquals(due, status.nextDueAt()); assertNotNull(status.lastConfirmedCareAt());
      assertEquals("CONFIRMED", service.read().charts.stream().filter(c -> c.id.equals(chartId)).findFirst().orElseThrow().status);
    }
  }

  @Test
  void legacyJsonImportPreservesConfirmedRepositioningPlan() throws Exception {
    String source = temporary.resolve("source").toAbsolutePath().toString().replace('\\', '/');
    String legacy = temporary.resolve("legacy").toAbsolutePath().toString().replace('\\', '/');
    String payload;
    String chartId;
    java.time.Instant confirmedAt;
    try (ConfigurableApplicationContext first = start(source)) {
      CareService service = first.getBean(CareService.class);
      service.reset();
      Movement movement = service.scenario("coordinated", "synthetic-icu-01").movements.getLast();
      State state = service.confirmTurn("synthetic-icu-01", new Command(null, "Verified synthetic care before migration", true, movement.id, null, null, null));
      var plan = state.repositioningPlans.stream().filter(p -> p.patientId.equals("synthetic-icu-01")).findFirst().orElseThrow();
      chartId = plan.confirmedChartId; confirmedAt = plan.lastConfirmedCareAt;
      payload = first.getBean(com.fasterxml.jackson.databind.ObjectMapper.class).writeValueAsString(state);
    }
    try (var connection = java.sql.DriverManager.getConnection("jdbc:h2:file:" + legacy, "sa", "")) {
      connection.createStatement().execute("create table store(id varchar(160) primary key, payload clob)");
      try (var insert = connection.prepareStatement("insert into store(id,payload) values('demo',?)")) {
        insert.setString(1, payload); insert.executeUpdate();
      }
    }
    try (ConfigurableApplicationContext migrated = start(legacy)) {
      State state = migrated.getBean(CareService.class).read();
      var plan = state.repositioningPlans.stream().filter(p -> p.patientId.equals("synthetic-icu-01")).findFirst().orElseThrow();
      assertEquals(chartId, plan.confirmedChartId); assertEquals(confirmedAt, plan.lastConfirmedCareAt);
      assertTrue(state.charts.stream().anyMatch(c -> chartId.equals(c.id) && "CONFIRMED".equals(c.status)));
      var jdbc = migrated.getBean(org.springframework.jdbc.core.JdbcTemplate.class);
      assertEquals(payload, jdbc.queryForObject("select payload from store where id='demo'", String.class));
      assertEquals(3, jdbc.queryForObject("select count(*) from repositioning_plans", Integer.class));
    }
  }
}
