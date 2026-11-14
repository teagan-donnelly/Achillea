package care.achillea;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "app.access.enabled=true",
    "app.access.password=local-test-demo-password-12345",
    "app.access.signing-key=local-test-separate-session-secret-123456",
    "app.access.secure-cookie=true",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
class DeploymentSecurityTest extends PostgresTestSupport {

  @Autowired
  MockMvc mvc;

  @Autowired
  SimulationService simulation;

  Cookie login() throws Exception {
    String header = mvc
      .perform(
        post("/api/session")
          .contentType("application/json")
          .content("{\"password\":\"local-test-demo-password-12345\"}")
      )
      .andExpect(status().isOk())
      .andReturn()
      .getResponse()
      .getHeader("Set-Cookie");
    assertNotNull(header);
    assertTrue(header.contains("HttpOnly"));
    assertTrue(header.contains("Secure"));
    assertTrue(header.contains("SameSite=Strict"));
    return new Cookie(
      DemoAccessFilter.COOKIE,
      header.substring(header.indexOf('=') + 1, header.indexOf(';'))
    );
  }

  @Test
  void protectsReadsAndWritesWhileHealthAndSessionStayAvailable()
    throws Exception {
    mvc.perform(get("/api/health")).andExpect(status().isOk());
    mvc
      .perform(get("/api/session"))
      .andExpect(jsonPath("$.required").value(true))
      .andExpect(jsonPath("$.authenticated").value(false));
    mvc
      .perform(get("/api/workspace?unit=ICU"))
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/demo/reset").contentType("application/json").content("{}")
      )
      .andExpect(status().isUnauthorized());
    Cookie cookie = login();
    mvc
      .perform(get("/api/workspace?unit=ICU").cookie(cookie))
      .andExpect(status().isOk())
      .andExpect(jsonPath("$.patients.length()").value(3));
    mvc
      .perform(
        post("/api/demo/tasks")
          .cookie(cookie)
          .contentType("application/json")
          .content(
            "{\"patientId\":\"synthetic-ld-01\",\"title\":\"Authenticated synthetic review\",\"dueAt\":\"2026-11-14T14:00:00Z\"}"
          )
      )
      .andExpect(status().isOk());
    mvc
      .perform(delete("/api/session").cookie(cookie))
      .andExpect(status().isOk())
      .andExpect(
        header().string(
          "Set-Cookie",
          org.hamcrest.Matchers.containsString("Max-Age=0")
        )
      );
  }

  @Test
  void rejectsTamperingBadCredentialsAndCrossSiteWrites() throws Exception {
    mvc
      .perform(
        post("/api/session")
          .contentType("application/json")
          .content("{\"password\":\"incorrect\"}")
      )
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/session").contentType("text/plain").content("password")
      )
      .andExpect(status().isUnsupportedMediaType());
    Cookie cookie = login();
    mvc
      .perform(
        get("/api/state").cookie(
          new Cookie(DemoAccessFilter.COOKIE, cookie.getValue() + "tampered")
        )
      )
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/demo/presets/routine-shift")
          .cookie(cookie)
          .header("Sec-Fetch-Site", "cross-site")
      )
      .andExpect(status().isForbidden());
  }

  @Test
  void simulatorKeyDoesNotGrantNursingOrAdminAccess() throws Exception {
    simulation.bind("access-test", "encounter-synthetic-icu-01");
    mvc
      .perform(
        get(
          "/api/integrations/simulation/v1/processed?sourceId=access-test&encounterId=encounter-synthetic-icu-01"
        ).header("X-Simulation-Key", "test-only-integration-key")
      )
      .andExpect(status().isOk());
    mvc
      .perform(
        get(
          "/api/integrations/simulation/v1/processed?sourceId=access-test&encounterId=encounter-synthetic-icu-01"
        )
      )
      .andExpect(status().isUnauthorized());
    mvc
      .perform(
        post("/api/chart/drafts")
          .header("X-Simulation-Key", "test-only-integration-key")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isUnauthorized());
  }

  MockEnvironment production() {
    MockEnvironment env = new MockEnvironment();
    env.setActiveProfiles("vercel");
    return env
      .withProperty("app.access.enabled", "true")
      .withProperty("app.access.secure-cookie", "true")
      .withProperty(
        "spring.datasource.url",
        "jdbc:postgresql://example.invalid:5432/tsdb?sslmode=verify-full"
      )
      .withProperty(
        "spring.datasource.hikari.data-source-properties.sslmode",
        "verify-full"
      );
  }

  @Test
  void failsClosedOnUnsafeProductionConfiguration() {
    assertDoesNotThrow(() -> DeploymentSafety.validate(production()));
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validate(
        production().withProperty("app.demo.allow-reset", "true")
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validate(
        production().withProperty("app.access.enabled", "false")
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validate(
        production().withProperty("app.monitor.enabled", "true")
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validate(
        production().withProperty(
          "spring.datasource.url",
          "jdbc:h2:mem:forbidden"
        )
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validateUrl(
        "jdbc:postgresql://example.invalid/db?sslmode=disable",
        false
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validateUrl(
        "jdbc:postgresql://example.invalid/db?sslmode=verify-full&sslfactory=org.postgresql.ssl.NonValidatingFactory",
        false
      )
    );
    assertThrows(IllegalStateException.class, () ->
      DeploymentSafety.validateUrl("jdbc:postgresql://example.invalid/db", true)
    );
  }
}
