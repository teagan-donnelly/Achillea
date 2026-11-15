package care.achillea;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** GET /api/stream: Server-Sent Events telling the UI to refresh after every saved change. */
@RestController
@RequestMapping("/api")
public class LiveController {

  private final LiveUpdates live;
  private final boolean demo;

  public LiveController(LiveUpdates live, @Value("${app.demo-mode}") boolean demo) {
    this.live = live;
    this.demo = demo;
  }

  @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream() {
    if (!demo) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Demo mode is disabled");
    return live.subscribe();
  }
}
