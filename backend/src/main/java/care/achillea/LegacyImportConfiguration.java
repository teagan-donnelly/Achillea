package care.achillea;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.*;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class LegacyImportConfiguration {

  @Bean
  @Order(-100)
  ApplicationRunner importLegacy(
    Environment env,
    RelationalStore store,
    ObjectMapper json,
    MonitorSimulation monitors,
    java.time.Clock clock,
    PlatformTransactionManager manager
  ) {
    return args -> {
      String file = env.getProperty("app.legacy-import.file", "");
      if (file.isBlank()) return;
      if (
        !env.getProperty("app.demo-mode", Boolean.class, false)
      ) throw new IllegalStateException(
        "Legacy import requires synthetic demo mode"
      );
      Model.State incoming = json.readValue(
        Files.readString(Path.of(file)),
        Model.State.class
      );
      monitors.ensureDevices(incoming, clock.instant());
      new TransactionTemplate(manager).executeWithoutResult(tx -> {
        store.jdbc().execute("select pg_advisory_xact_lock(41231001)");
        if (
          store
            .jdbc()
            .queryForObject("select count(*) from patients", Integer.class) != 0
        ) throw new IllegalStateException(
          "Legacy import requires an empty target schema; existing data was not replaced"
        );
        store.save(incoming);
      });
    };
  }
}
