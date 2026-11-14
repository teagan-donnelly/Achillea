package care.achillea;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.context.annotation.*;
import org.springframework.core.env.*;

@Configuration
class DeploymentSafety {

  static void validate(Environment env) {
    if (
      !env.acceptsProfiles(Profiles.of("vercel")) &&
      !"1".equals(env.getProperty("VERCEL"))
    ) return;
    if (
      !env.getProperty("app.access.enabled", Boolean.class, false) ||
      !env.getProperty("app.access.secure-cookie", Boolean.class, false) ||
      env.getProperty("app.demo.allow-reset", Boolean.class, false) ||
      env.getProperty("app.monitor.enabled", Boolean.class, false) ||
      !env.getProperty("app.legacy-import.file", "").isBlank()
    ) throw new IllegalStateException(
      "Vercel requires protected secure sessions, disabled destructive reset/import, and an externally triggered simulator"
    );
    if (
      !"verify-full".equals(
        env.getProperty(
          "spring.datasource.hikari.data-source-properties.sslmode"
        )
      )
    ) throw new IllegalStateException(
      "Vercel PostgreSQL requires verify-full TLS"
    );
    validateUrl(env.getProperty("spring.datasource.url", ""), true);
    String flyway = env.getProperty("spring.flyway.url", "");
    if (!flyway.isBlank()) validateUrl(flyway, true);
  }

  static void validateUrl(String url, boolean separateMigrationConnection) {
    if (!url.startsWith("jdbc:postgresql://")) throw new IllegalStateException(
      "Vercel requires an explicit PostgreSQL JDBC connection; no filesystem database fallback"
    );
    Map<String, String> params = new HashMap<>();
    if (url.contains("?")) for (String entry : url
      .substring(url.indexOf('?') + 1)
      .split("&")) {
      String[] parts = entry.split("=", 2);
      params.put(
        URLDecoder.decode(parts[0], StandardCharsets.UTF_8).toLowerCase(
          Locale.ROOT
        ),
        parts.length == 2
          ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8)
          : ""
      );
    }
    if (
      (params.containsKey("sslmode") &&
        !"verify-full".equals(params.get("sslmode"))) ||
      (separateMigrationConnection &&
        !"verify-full".equals(params.get("sslmode"))) ||
      (params.containsKey("sslfactory") &&
        !"org.postgresql.ssl.DefaultJavaSSLFactory".equals(
          params.get("sslfactory")
        ))
    ) throw new IllegalStateException(
      "Database URL must use verify-full TLS and a validating SSL factory"
    );
  }

  @Bean
  static BeanFactoryPostProcessor deploymentChecks(Environment env) {
    return factory -> validate(env);
  }
}
