package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.util.*;
import org.springframework.stereotype.Component;

/** Deterministic smooth illustrative measurements, never clinical interpretations. */
@Component
public class MonitorSimulation {

  public void ensureDevices(State s, Instant now) {
    if (s.demoStartedAt == null) s.demoStartedAt = now;
    for (Patient p : s.patients) {
      if (
        s.devices
          .stream()
          .noneMatch(
            d ->
              d.patientId.equals(p.id()) &&
              d.bodyRegion.equals("BEDSIDE_MONITOR")
          )
      ) {
        Vital latestVital = s.vitals
          .stream()
          .filter(v -> v.patientId().equals(p.id()))
          .max(Comparator.comparing(Vital::receivedAt))
          .orElse(null);
        Device monitor = new Device(
          "monitor-" + p.id(),
          p.id(),
          "BEDSIDE_MONITOR",
          latestVital == null ? null : latestVital.receivedAt()
        );
        monitor.lastSampledAt =
          latestVital == null ? null : latestVital.observedAt();
        s.devices.add(monitor);
      }
      if (p.repositionPlan()) for (String region : List.of(
        "UPPER_TORSO",
        "PELVIS"
      )) {
        if (
          s.devices
            .stream()
            .noneMatch(
              d -> d.patientId.equals(p.id()) && d.bodyRegion.equals(region)
            )
        ) {
          OrientationSample latestSample = s.samples
            .stream()
            .filter(
              x -> x.patientId().equals(p.id()) && x.bodyRegion().equals(region)
            )
            .max(Comparator.comparing(OrientationSample::receivedAt))
            .orElse(null);
          Device device = new Device(
            region.equals("PELVIS")
              ? DemoSeeder.pelvisId(p.id())
              : DemoSeeder.chestId(p.id()),
            p.id(),
            region,
            latestSample == null ? null : latestSample.receivedAt()
          );
          device.lastSampledAt =
            latestSample == null ? null : latestSample.capturedAt();
          Movement latest = s.movements
            .stream()
            .filter(m -> m.patientId.equals(p.id()))
            .max(Comparator.comparing(m -> m.capturedAt))
            .orElse(null);
          if (
            region.equals("PELVIS") &&
            latest != null &&
            "PELVIS_DISCONNECTED".equals(latest.quality)
          ) device.connectionState = "DISCONNECTED";
          s.devices.add(device);
        }
      }
    }
  }

  public void tick(State s, Instant now) {
    s.monitorTick++;
    for (int index = 0; index < s.patients.size(); index++) {
      Patient p = s.patients.get(index);
      Device d = monitor(s, p.id());
      if (!d.manualOverride) {
        long phase = Math.floorMod(s.monitorTick + index * 3L, 40);
        String next =
          phase == 12 || phase == 13
            ? "DISCONNECTED"
            : phase == 14
              ? "DELAYED"
              : "CONNECTED";
        transition(s, d, next, now);
      }
      if (d.connectionState.equals("DISCONNECTED")) continue;
      Instant sampled = now.minusSeconds(
        d.connectionState.equals("DELAYED") ? 90 : 1
      );
      if (
        d.lastSampledAt != null &&
        !sampled.isAfter(d.lastSampledAt) &&
        !d.connectionState.equals("DELAYED")
      ) continue;
      double wave = Math.sin(
        (sampled.getEpochSecond() - s.demoStartedAt.getEpochSecond()) / 90.0 +
          index
      );
      add(
        s,
        p.id(),
        "HEART_RATE",
        Math.rint(72 + (index % 6) * 3 + wave * 5),
        "bpm",
        sampled,
        now,
        d
      );
      add(
        s,
        p.id(),
        "SPO2",
        97 + Math.floorMod(index + s.monitorTick / 4, 3),
        "%",
        sampled,
        now,
        d
      );
      add(
        s,
        p.id(),
        "RESPIRATORY_RATE",
        14 + Math.floorMod(index + s.monitorTick / 3, 5),
        "breaths/min",
        sampled,
        now,
        d
      );
      d.lastSeenAt = now;
      d.lastSampledAt = sampled;
      audit(
        s,
        p.id(),
        "vital.received",
        "Simulated measurements received from " +
          d.id +
          " · " +
          d.connectionState,
        now
      );
    }
    // Orientation heartbeat samples do not create movement candidates or verified care.
    for (Device d : s.devices)
      if (
        !d.bodyRegion.equals("BEDSIDE_MONITOR") &&
        d.connectionState.equals("CONNECTED")
      ) {
        OrientationSample previous = s.samples
          .stream()
          .filter(x -> x.sensorId().equals(d.id))
          .reduce((a, b) -> a.receivedAt().isAfter(b.receivedAt()) ? a : b)
          .orElse(null);
        s.samples.add(
          new OrientationSample(
            UUID.randomUUID().toString(),
            d.id,
            d.patientId,
            d.bodyRegion,
            previous == null ? 0 : previous.rollDegrees(),
            now,
            now,
            "SIMULATED_GOOD",
            "SIMULATED"
          )
        );
        d.lastSeenAt = now;
        d.lastSampledAt = now;
      }
    retainHistory(s);
  }

  private void add(
    State s,
    String patient,
    String metric,
    double value,
    String unit,
    Instant sampled,
    Instant received,
    Device d
  ) {
    String id = UUID.randomUUID().toString();
    s.vitals.add(
      new Vital(
        id,
        patient,
        metric,
        value,
        unit,
        sampled,
        received,
        "SIMULATED_MONITOR",
        id,
        d.connectionState.equals("DELAYED") ? "DELAYED" : "VALID",
        d.id
      )
    );
  }

  public Device monitor(State s, String patientId) {
    return s.devices
      .stream()
      .filter(
        d ->
          d.patientId.equals(patientId) &&
          d.bodyRegion.equals("BEDSIDE_MONITOR")
      )
      .findFirst()
      .orElseThrow();
  }

  public void transition(State s, Device d, String next, Instant now) {
    if (!d.connectionState.equals(next)) {
      d.connectionState = next;
      audit(
        s,
        d.patientId,
        "device." + next.toLowerCase(Locale.ROOT),
        d.id + " · " + next + " · simulated",
        now
      );
    }
  }

  public static void audit(
    State s,
    String patient,
    String type,
    String details,
    Instant now
  ) {
    s.events.add(
      new Event(
        UUID.randomUUID().toString(),
        patient,
        type,
        "SIMULATOR",
        details,
        now
      )
    );
  }

  public static void freshness(State s, Instant now) {
    for (Device d : s.devices)
      d.freshness =
        d.lastSampledAt == null
          ? "UNKNOWN"
          : d.connectionState.equals("DISCONNECTED")
            ? "DISCONNECTED"
            : d.lastSampledAt.isBefore(now.minusSeconds(60))
              ? "STALE"
              : "FRESH";
  }

  private void retainHistory(State s) {
    // Retain at most 360 unlinked observations per patient/metric, but never delete chart provenance.
    Set<String> linked = new HashSet<>();
    s.charts.forEach(c -> linked.addAll(c.linkedVitalIds));
    Map<String, Integer> counts = new HashMap<>();
    Set<String> keep = new HashSet<>(linked);
    s.vitals
      .stream()
      .sorted(Comparator.comparing(Vital::observedAt).reversed())
      .forEach(v -> {
        int count = counts.merge(
          v.patientId() + "/" + v.metric(),
          1,
          Integer::sum
        );
        if (count <= 360) keep.add(v.id());
      });
    s.vitals.removeIf(v -> !keep.contains(v.id()));
    Set<String> sampleRefs = new HashSet<>();
    s.movements.forEach(m -> sampleRefs.addAll(m.sampleIds));
    Map<String, Integer> samples = new HashMap<>();
    Set<String> retainedSamples = new HashSet<>(sampleRefs);
    s.samples
      .stream()
      .sorted(Comparator.comparing(OrientationSample::capturedAt).reversed())
      .forEach(x -> {
        if (
          samples.merge(x.sensorId(), 1, Integer::sum) <= 360
        ) retainedSamples.add(x.id());
      });
    s.samples.removeIf(x -> !retainedSamples.contains(x.id()));
    if (s.events.size() > 4000) s.events
      .subList(0, s.events.size() - 4000)
      .clear();
  }
}
