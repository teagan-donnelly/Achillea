package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Additive V3 API. V2 consumers may continue using the original controller. */
@RestController
@RequestMapping("/api")
public class ClinicalController {

  private final CareService service;
  private final boolean demo;

  public ClinicalController(
    CareService service,
    @Value("${app.demo-mode}") boolean demo
  ) {
    this.service = service;
    this.demo = demo;
  }

  private void enabled() {
    if (!demo) throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Demo mode is disabled"
    );
  }

  private State scope(String unit, String patientId) {
    enabled();
    State s = service.read();
    if (unit != null) CareService.validateUnit(unit);
    if (patientId != null) service.patient(s, patientId);
    Set<String> ids = new HashSet<>();
    s.patients
      .stream()
      .filter(
        p ->
          (unit == null || unit.equals(p.unit())) &&
          (patientId == null || patientId.equals(p.id()))
      )
      .forEach(p -> ids.add(p.id()));
    s.patients.removeIf(p -> !ids.contains(p.id()));
    s.tasks.removeIf(t -> !ids.contains(t.patientId));
    s.vitals.removeIf(v -> !ids.contains(v.patientId()));
    s.samples.removeIf(x -> !ids.contains(x.patientId()));
    s.movements.removeIf(m -> !ids.contains(m.patientId));
    s.charts.removeIf(c -> !ids.contains(c.patientId));
    s.devices.removeIf(d -> !ids.contains(d.patientId));
    s.repositioningPlans.removeIf(p -> !ids.contains(p.patientId));
    s.events.removeIf(
      e -> e.patientId() != null && !ids.contains(e.patientId())
    );
    return s;
  }

  @GetMapping("/activity/summary")
  public Object activity(
    @RequestParam(required = false) String unit,
    @RequestParam(required = false) String patientId
  ) {
    return ClinicalViews.activity(scope(unit, patientId));
  }

  @GetMapping("/repositioning")
  public Object repositioning(@RequestParam String unit) {
    enabled();
    return service.repositioning(unit);
  }

  @PostMapping("/patients/{id}/repositioning/confirm")
  public Object confirmTurn(
    @PathVariable String id,
    @RequestBody Command command
  ) {
    enabled();
    return service.confirmTurn(id, command);
  }

  @PostMapping("/demo/repositioning")
  public Object repositioningDemo() {
    enabled();
    return service.repositioningDemo();
  }

  /** Lightweight workflow snapshot; observation/audit history comes from the delta API. */
  @GetMapping("/workspace")
  public State workspace(@RequestParam String unit) {
    State s = scope(unit, null);
    s.vitals.clear();
    s.samples.clear();
    s.events.clear();
    return s;
  }

  public record Updates(
    Instant serverTime,
    Instant nextSince,
    boolean inclusive,
    List<Vital> measurements,
    List<OrientationSample> orientationSamples,
    List<Device> devices,
    List<Event> events
  ) {}

  @GetMapping("/monitoring/updates")
  public Updates updates(
    @RequestParam(required = false) String unit,
    @RequestParam(required = false) String patientId,
    @RequestParam(required = false) Instant since
  ) {
    State s = scope(unit, patientId);
    CareService.input(
      since == null || !since.isAfter(s.serverTime),
      "since cannot be in the future"
    );
    return new Updates(
      s.serverTime,
      s.serverTime,
      true,
      s.vitals
        .stream()
        .filter(v -> since == null || !v.receivedAt().isBefore(since))
        .sorted(
          Comparator.comparing(Vital::receivedAt).thenComparing(Vital::id)
        )
        .toList(),
      s.samples
        .stream()
        .filter(x -> since == null || !x.receivedAt().isBefore(since))
        .sorted(
          Comparator.comparing(OrientationSample::receivedAt).thenComparing(
            OrientationSample::id
          )
        )
        .toList(),
      s.devices,
      s.events
        .stream()
        .filter(e -> since == null || !e.timestamp().isBefore(since))
        .toList()
    );
  }

  @GetMapping("/patients/{id}/sensor-history")
  public Object sensors(@PathVariable String id) {
    State s = scope(null, id);
    return Map.of(
      "patientId",
      id,
      "orientationUnit",
      "degrees",
      "ruleVersion",
      "SYNTHETIC_REGION_REVIEW_V1",
      "samples",
      s.samples,
      "devices",
      s.devices
        .stream()
        .filter(d -> !"BEDSIDE_MONITOR".equals(d.bodyRegion))
        .toList(),
      "connectivityEvents",
      s.events
        .stream()
        .filter(
          e ->
            id.equals(e.patientId()) &&
            e.type().startsWith("device.") &&
            s.devices
              .stream()
              .anyMatch(
                d ->
                  !"BEDSIDE_MONITOR".equals(d.bodyRegion) &&
                  e.details().contains(d.id)
              )
        )
        .toList(),
      "movements",
      s.movements
        .stream()
        .map(m ->
          Map.of(
            "movement",
            m,
            "charts",
            s.charts
              .stream()
              .filter(c -> m.id.equals(c.linkedMovementId))
              .toList()
          )
        )
        .toList()
    );
  }

  @PostMapping("/demo/tasks")
  public Object schedule(@RequestBody CareService.ScheduleRequest request) {
    enabled();
    return service.schedule(request);
  }

  @GetMapping("/demo/presets")
  public Object presets() {
    enabled();
    return Map.of(
      "keys",
      CareService.presetKeys(),
      "synthetic",
      true,
      "automaticConfirmation",
      false,
      "destructiveReset",
      false
    );
  }

  @PostMapping("/demo/presets/{key}")
  public Object preset(
    @PathVariable String key,
    @RequestParam(required = false) String patientId
  ) {
    enabled();
    return service.preset(key, patientId);
  }
}
