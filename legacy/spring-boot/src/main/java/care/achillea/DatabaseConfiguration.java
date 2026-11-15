package care.achillea;

import java.time.Clock;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.transaction.support.TransactionTemplate;

@Configuration
class DatabaseConfiguration {

  @Bean
  static BeanFactoryPostProcessor postgresRequired(Environment env) {
    return factory -> {
      String url = env.getProperty("spring.datasource.url", "");
      if (
        !url.startsWith("jdbc:postgresql://")
      ) throw new IllegalStateException(
        "Configure SPRING_DATASOURCE_URL as a PostgreSQL JDBC URL; H2 fallback is disabled. Supply database username/password via backend secrets."
      );
      if (
        env.getProperty("app.simulation.enabled", Boolean.class, false) &&
        env.getProperty("app.demo-mode", Boolean.class, false) &&
        env.getProperty("app.simulation.key", "").length() < 24
      ) throw new IllegalStateException(
        "External simulation requires demo mode and a secret SIMULATION_API_KEY of at least 24 characters"
      );
    };
  }

  @Bean
  ApplicationRunner initializeSyntheticData(
    RelationalStore store,
    DemoSeeder seeder,
    SimulationService simulation,
    Clock clock,
    Environment env,
    org.springframework.transaction.PlatformTransactionManager manager
  ) {
    return args -> {
      if (
        env.getProperty("app.demo.seed", Boolean.class, false) &&
        env.getProperty("app.demo-mode", Boolean.class, false)
      ) new TransactionTemplate(manager).executeWithoutResult(status -> {
        store.jdbc().execute("select pg_advisory_xact_lock(41231001)");
        if (
          store
            .jdbc()
            .queryForObject("select count(*) from patients", Long.class) == 0
        ) store.save(seeder.create(clock.instant()));
      });
      if (
        env.getProperty("app.simulation.enabled", Boolean.class, false)
      ) for (String entry : env
        .getProperty("app.simulation.bindings", "")
        .split(",")) {
        if (entry.isBlank()) continue;
        String[] parts = entry.trim().split("=", -1);
        if (parts.length != 2) throw new IllegalStateException(
          "SIMULATION_BINDINGS must be sourceId=encounterId pairs separated by commas"
        );
        simulation.bind(parts[0], parts[1]);
      }
    };
  }
}
