package care.achillea;

import static care.achillea.Model.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
  properties = {
    "spring.datasource.url=jdbc:h2:mem:live-updates;DB_CLOSE_DELAY=-1",
    "app.monitor.enabled=false",
  }
)
@AutoConfigureMockMvc
class LiveUpdatesTest {

  @Autowired
  CareService service;

  @Autowired
  LiveUpdates live;

  @Autowired
  MockMvc mvc;

  @Test
  void streamEndpointOpensAnEventStream() throws Exception {
    mvc
      .perform(get("/api/stream"))
      .andExpect(status().isOk())
      .andExpect(request().asyncStarted())
      .andExpect(header().string("Content-Type", org.hamcrest.Matchers.startsWith("text/event-stream")));
    assertTrue(live.subscribers() >= 1);
  }

  @Test
  void everySavedWriteBumpsTheRevision() {
    service.read();
    long before = live.revision();
    service.ingest(new Observation("live-1", "synthetic-icu-01", "HEART_RATE", 77, "bpm", Instant.now(), "VALID"));
    assertTrue(live.revision() > before, "a committed write must notify live subscribers");
    long afterWrite = live.revision();
    service.read();
    assertEquals(afterWrite, live.revision(), "plain reads must not notify");
  }
}
