package care.achillea;

import static care.achillea.Model.*;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Bucketed history over the full persisted stay. Buckets without valid readings are omitted (no
 * interpolation, no zero-fill); coverage fields describe every stored reading of the series.
 */
@RestController
@RequestMapping("/api/patients/{id}")
public class HistoryController {

  static final int MAX_BUCKET_MINUTES = 10080;
  static final Set<String> VALID_ORIENTATION = Set.of("VALID", "SIMULATED_GOOD");

  private final CareService service;
  private final boolean demo;

  public HistoryController(CareService service, @Value("${app.demo-mode}") boolean demo) {
    this.service = service;
    this.demo = demo;
  }

  public record Point(Instant t, double value, double min, double max, int count) {}

  public record Series(
    String patientId,
    String metric,
    String unit,
    Instant from,
    Instant to,
    int bucketMinutes,
    List<Point> points,
    Instant firstObservedAt,
    Instant lastObservedAt,
    int totalReadings
  ) {}

  /** One reading of any series: time, value, quality, unit. */
  record Reading(Instant at, double value, boolean valid, String unit) {}

  @GetMapping("/vitals/series")
  public Series vitals(
    @PathVariable String id,
    @RequestParam(required = false) String metric,
    @RequestParam(required = false) Instant from,
    @RequestParam(required = false) Instant to,
    @RequestParam(required = false) Integer bucketMinutes,
    @RequestParam(defaultValue = "false") boolean fullStay
  ) {
    enabled();
    CareService.input(metric != null && !metric.isBlank(), "metric is required");
    State s = service.read();
    service.patient(s, id);
    List<Reading> readings = s.vitals
      .stream()
      .filter(v -> v.patientId().equals(id) && metric.equals(v.metric()) && v.observedAt() != null)
      .map(v -> new Reading(v.observedAt(), v.value(), "VALID".equals(v.quality()), v.unit()))
      .toList();
    return series(id, metric, null, readings, fullStay ? earliest(readings, to == null ? s.serverTime : to) : from, to, bucketMinutes, s.serverTime);
  }

  @GetMapping("/orientation/series")
  public Series orientation(
    @PathVariable String id,
    @RequestParam(required = false) String region,
    @RequestParam(required = false) Instant from,
    @RequestParam(required = false) Instant to,
    @RequestParam(required = false) Integer bucketMinutes,
    @RequestParam(defaultValue = "false") boolean fullStay
  ) {
    enabled();
    CareService.input(
      "UPPER_TORSO".equals(region) || "PELVIS".equals(region),
      "region must be UPPER_TORSO or PELVIS"
    );
    State s = service.read();
    service.patient(s, id);
    List<Reading> readings = s.samples
      .stream()
      .filter(x -> x.patientId().equals(id) && region.equals(x.bodyRegion()) && x.capturedAt() != null)
      .map(x -> new Reading(x.capturedAt(), x.rollDegrees(), VALID_ORIENTATION.contains(x.quality()), "°"))
      .toList();
    return series(id, region, "°", readings, fullStay ? earliest(readings, to == null ? s.serverTime : to) : from, to, bucketMinutes, s.serverTime);
  }

  private static Instant earliest(List<Reading> readings, Instant end) {
    return readings.stream().map(Reading::at).filter(at -> !at.isAfter(end)).min(Instant::compareTo).orElse(end);
  }

  static Series series(
    String patientId,
    String metric,
    String fixedUnit,
    List<Reading> readings,
    Instant from,
    Instant to,
    Integer bucketMinutes,
    Instant now
  ) {
    Instant end = to == null ? now : to;
    Instant start = from == null ? end.minus(Duration.ofHours(24)) : from;
    CareService.input(!start.isAfter(end), "from must not be after to");
    long rangeSeconds = Duration.between(start, end).getSeconds();
    int minutes = bucketMinutes != null
      ? bucketMinutes
      : (int) Math.min(MAX_BUCKET_MINUTES, Math.max(1, (long) Math.ceil(rangeSeconds / 60.0 / 96.0)));
    minutes = Math.max(1, Math.min(MAX_BUCKET_MINUTES, minutes));
    long bucketMillis = minutes * 60_000L;

    Instant first = null, last = null;
    Reading latest = null;
    TreeMap<Long, double[]> buckets = new TreeMap<>(); // index -> {sum, min, max, count}
    for (Reading r : readings) {
      if (first == null || r.at().isBefore(first)) first = r.at();
      if (last == null || r.at().isAfter(last)) last = r.at();
      if (latest == null || !r.at().isBefore(latest.at())) latest = r;
      if (!r.valid() || !Double.isFinite(r.value()) || r.at().isBefore(start) || r.at().isAfter(end)) continue;
      long index = Duration.between(start, r.at()).toMillis() / bucketMillis;
      double[] b = buckets.computeIfAbsent(
        index,
        k -> new double[] { 0, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, 0 }
      );
      b[0] += r.value();
      b[1] = Math.min(b[1], r.value());
      b[2] = Math.max(b[2], r.value());
      b[3]++;
    }
    List<Point> points = new ArrayList<>(buckets.size());
    for (Map.Entry<Long, double[]> e : buckets.entrySet()) {
      double[] b = e.getValue();
      points.add(
        new Point(
          start.plusMillis(e.getKey() * bucketMillis),
          Math.round(b[0] / b[3] * 100.0) / 100.0,
          b[1],
          b[2],
          (int) b[3]
        )
      );
    }
    String unit = fixedUnit != null
      ? fixedUnit
      : latest == null ? "" : Objects.toString(latest.unit(), "");
    return new Series(patientId, metric, unit, start, end, minutes, points, first, last, readings.size());
  }

  private void enabled() {
    if (!demo) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Demo mode is disabled");
  }
}
