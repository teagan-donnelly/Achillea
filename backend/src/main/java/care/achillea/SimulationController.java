package care.achillea;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/integrations/simulation/v1")
class SimulationController {

  private final SimulationService service;
  private final int maxBatch;

  SimulationController(
    SimulationService service,
    @Value("${app.simulation.max-batch}") int maxBatch
  ) {
    this.service = service;
    this.maxBatch = maxBatch;
  }

  @PostMapping("/observations")
  Object observations(@RequestBody SimulationService.Batch batch) {
    return service.ingest(batch, maxBatch);
  }

  @GetMapping("/processed")
  Map<String, Object> processed(
    @RequestParam String encounterId,
    @RequestParam String sourceId,
    @RequestParam(defaultValue = "0") long after,
    @RequestParam(defaultValue = "100") int limit
  ) {
    return service.history(encounterId, sourceId, after, limit);
  }
}
