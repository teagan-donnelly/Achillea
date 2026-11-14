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
}
