package care.achillea;

import static care.achillea.Model.*;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

public interface SensorAdapter {
  Movement sample(String scenario, Movement previous);

  class Simulator implements SensorAdapter {

    private final Clock clock;

    public Simulator() {
      this(Clock.systemUTC());
    }

    public Simulator(Clock clock) {
      this.clock = clock;
    }

    public Movement sample(String scenario, Movement previous) {
      Movement m = new Movement();
      m.id = UUID.randomUUID().toString();
      m.patientId = "synthetic-icu-01";
      m.capturedAt = clock
        .instant()
        .minusSeconds(scenario.equals("sensor-delay") ? 90 : 0);
      m.receivedAt = clock.instant();
      m.chestBefore = previous == null ? 0 : previous.chestAfter;
      m.pelvisBefore = previous == null ? 0 : previous.pelvisAfter;
      double delta = scenario.equals("minor") ? 4 : 35;
      m.chestAfter = List.of(
        "partial",
        "coordinated",
        "minor",
        "sensor-delay",
        "uncertain",
        "incomplete"
      ).contains(scenario)
        ? wrap(m.chestBefore + delta)
        : m.chestBefore;
      m.pelvisAfter = List.of(
        "coordinated",
        "minor",
        "pelvic-only",
        "sensor-delay",
        "uncertain"
      ).contains(scenario)
        ? wrap(m.pelvisBefore + delta)
        : m.pelvisBefore;
      m.classification = switch (scenario) {
        case "disconnect" -> "UNKNOWN";
        case "partial" -> "PARTIAL_TORSO_MOVEMENT";
        case "pelvic-only" -> "PARTIAL_PELVIC_MOVEMENT";
        case "uncertain", "incomplete" -> "UNKNOWN";
        case "sensor-delay" -> "COORDINATED_TURN_CANDIDATE";
        case "coordinated" -> "COORDINATED_TURN_CANDIDATE";
        default -> "SMALL_ADJUSTMENT";
      };
      m.quality = scenario.equals("disconnect")
        ? "PELVIS_DISCONNECTED"
        : "SIMULATED_GOOD";
      m.confidence = scenario.equals("disconnect") ? null : .85;
      if (scenario.equals("sensor-delay")) m.quality = "DELAYED";
      if (scenario.equals("uncertain")) {
        m.quality = "UNCERTAIN";
        m.confidence = .35;
      }
      if (scenario.equals("incomplete")) {
        m.quality = "INCOMPLETE";
        m.confidence = null;
      }
      m.sampleIds = List.of("disconnect", "incomplete").contains(scenario)
        ? List.of(m.id + "-chest")
        : List.of(m.id + "-chest", m.id + "-pelvis");
      WorkflowRules.classify(m);
      return m;
    }

    private double wrap(double value) {
      return ((value + 180) % 360) - 180;
    }
  }
}
