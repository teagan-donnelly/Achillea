package care.achillea;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.util.UUID;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Native PostgreSQL, test-only; never reads hosted credentials. */
abstract class PostgresTestSupport {

  @org.junit.jupiter.api.BeforeEach
  void quietSql() {
    (
      (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
        "org.springframework.jdbc"
      )
    ).setLevel(ch.qos.logback.classic.Level.ERROR);
    (
      (ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger(
        "org.springframework.transaction"
      )
    ).setLevel(ch.qos.logback.classic.Level.ERROR);
  }

  static final EmbeddedPostgres PG;

  static {
    try {
      PG = EmbeddedPostgres.builder().setPort(0).start();
      Runtime.getRuntime().addShutdownHook(
        new Thread(() -> {
          try {
            PG.close();
          } catch (Exception ignored) {}
        })
      );
    } catch (Exception e) {
      throw new ExceptionInInitializerError(e);
    }
  }

  static String databaseUrl() {
    try (var c = PG.getPostgresDatabase().getConnection()) {
      String schema = "test_" + UUID.randomUUID().toString().replace("-", "");
      c.createStatement().execute("create schema " + schema);
      String url = c.getMetaData().getURL();
      return url + (url.contains("?") ? "&" : "?") + "currentSchema=" + schema;
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @DynamicPropertySource
  static void postgres(DynamicPropertyRegistry registry) {
    String url = databaseUrl();
    String schema = url.substring(url.indexOf("currentSchema=") + 14);
    registry.add("spring.datasource.hikari.schema", () -> schema);
    registry.add("spring.flyway.default-schema", () -> schema);
    registry.add("spring.flyway.schemas", () -> schema);
    registry.add("spring.datasource.url", () -> url);
    registry.add("spring.datasource.username", () -> "postgres");
    registry.add("spring.datasource.password", () -> "postgres");
    registry.add(
      "spring.datasource.hikari.data-source-properties.sslmode",
      () -> "disable"
    );
    registry.add("app.demo.seed", () -> "true");
    registry.add("app.demo.allow-reset", () -> "true");
    registry.add("logging.level.root", () -> "ERROR");
    registry.add("logging.level.org.springframework", () -> "ERROR");
    registry.add("debug", () -> "false");
    registry.add("app.monitor.enabled", () -> "false");
    registry.add("app.simulation.enabled", () -> "true");
    registry.add("app.simulation.key", () -> "test-only-integration-key");
  }
}
