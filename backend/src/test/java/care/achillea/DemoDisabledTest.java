package care.achillea;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:disabled",
    "app.demo-mode=false",
  }
)
@AutoConfigureMockMvc
class DemoDisabledTest {

  @Autowired
  MockMvc mvc;

  @Autowired
  ApplicationContext context;

  @Test
  void disabledModeStopsSchedulerAndRejectsNewAndOldDemoOperations()
    throws Exception {
    assertTrue(context.getBeansOfType(MonitorScheduler.class).isEmpty());
    mvc.perform(get("/api/health")).andExpect(status().isOk());
    mvc.perform(get("/api/demo/census")).andExpect(status().isForbidden());
    mvc.perform(get("/api/state")).andExpect(status().isForbidden());
    mvc
      .perform(get("/api/patients/synthetic-ld-01/devices"))
      .andExpect(status().isForbidden());
    mvc
      .perform(
        post("/api/demo/reset").contentType("application/json").content("{}")
      )
      .andExpect(status().isForbidden());
    mvc
      .perform(
        post("/api/demo/scenarios/monitor-tick")
          .contentType("application/json")
          .content("{}")
      )
      .andExpect(status().isForbidden());
  }
}
