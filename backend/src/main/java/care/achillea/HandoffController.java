package care.achillea;

import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Shift handoff API (see HandoffService). Demo-mode guarded like the rest of /api. */
@RestController
@RequestMapping("/api/handoffs")
public class HandoffController {

  private final HandoffService handoffs;
  private final boolean demo;

  public HandoffController(HandoffService handoffs, @Value("${app.demo-mode}") boolean demo) {
    this.handoffs = handoffs;
    this.demo = demo;
  }

  private void enabled() {
    if (!demo) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Demo mode is disabled");
  }

  @GetMapping
  public List<Map<String, Object>> list(
    @RequestParam(required = false) String patientId,
    @RequestParam(required = false) String status,
    @RequestParam(required = false) String unit
  ) {
    enabled();
    return handoffs.list(patientId, status, unit);
  }

  @GetMapping("/{id}")
  public Map<String, Object> detail(@PathVariable String id) {
    enabled();
    return handoffs.detail(id);
  }

  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> create(@RequestBody(required = false) HandoffService.CreateRequest body) {
    enabled();
    return handoffs.create(body);
  }

  @PatchMapping("/{id}")
  public Map<String, Object> update(
    @PathVariable String id,
    @RequestBody(required = false) HandoffService.UpdateRequest body
  ) {
    enabled();
    return handoffs.update(id, body);
  }

  @PostMapping("/{id}/{action:ready|review|acknowledge}")
  public Map<String, Object> transition(
    @PathVariable String id,
    @PathVariable String action,
    @RequestBody(required = false) Map<String, Object> body
  ) {
    enabled();
    // Strict: only a JSON boolean true counts as verification (no "true" string coercion).
    boolean verified = body != null && Boolean.TRUE.equals(body.get("verified"));
    return handoffs.transition(id, action, new HandoffService.AcknowledgeRequest(verified));
  }
}
