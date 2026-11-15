package care.achillea;

import static care.achillea.Model.*;

import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Recorded-data replay controls, monitoring alerts and source-linked handoff context. */
@RestController
@RequestMapping("/api")
public class MonitoringController {

  private final CareService care;
  private final ReplayEngine replay;
  private final boolean demo;

  public MonitoringController(CareService care, ReplayEngine replay, @Value("${app.demo-mode}") boolean demo) {
    this.care = care;
    this.replay = replay;
    this.demo = demo;
  }

  private void enabled() {
    if (!demo) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Demo mode is disabled");
  }

  public record ReplayCommand(Integer speed, Boolean loop) {}

  @GetMapping("/replay/status")
  public Map<String, Object> status() {
    enabled();
    return replay.status();
  }

  @PostMapping("/replay/{action:pause|resume|restart|speed|loop}")
  public Map<String, Object> control(@PathVariable String action, @RequestBody(required = false) ReplayCommand body) {
    enabled();
    return replay.control(action, body == null ? null : body.speed(), body == null ? null : body.loop());
  }

  @GetMapping("/monitoring/alerts")
  public List<Map<String, Object>> alerts(@RequestParam(required = false) String patientId) {
    enabled();
    return ShiftContext.alerts(care.read(), patientId);
  }

  /** Nurse review of an alert. Audit only: never completes the task or documents care. */
  @PostMapping("/monitoring/alerts/{id}/acknowledge")
  public Map<String, Object> acknowledge(@PathVariable String id) {
    enabled();
    return care.mutate(s -> {
      Task t = s.tasks.stream().filter(x -> x.id.equals(id) && MonitorAnalysis.TYPE.equals(x.type)).findFirst()
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Monitoring alert not found"));
      CareService.require(WorkflowRules.active(t), "Alert is already resolved");
      if (!ShiftContext.acknowledged(s, t)) s.events.add(new Event("ack:" + t.id, t.patientId, "alert.acknowledged",
        "nurse-demo", "Monitoring alert acknowledged: " + t.title + ". Follow-up documentation is separate.", care.now()));
      return ShiftContext.alert(s, t, care.patient(s, t.patientId));
    });
  }

  @GetMapping("/patients/{id}/handoff-context")
  public Map<String, Object> handoffContext(@PathVariable String id) {
    enabled();
    State s = care.read();
    return ShiftContext.handoff(s, care.patient(s, id), care.now(), replay.status());
  }
}
