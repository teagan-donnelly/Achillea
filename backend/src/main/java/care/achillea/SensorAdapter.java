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
      m.capturedAt = clock.instant();
      m.receivedAt = clock.instant();
      m.chestBefore = previous == null ? 0 : previous.chestAfter;
      m.pelvisBefore = previous == null ? 0 : previous.pelvisAfter;
      double delta = scenario.equals("minor") ? 4 : 35;
      m.chestAfter = List.of("partial", "coordinated", "minor").contains(
        scenario
      )
        ? wrap(m.chestBefore + delta)
        : m.chestBefore;
      m.pelvisAfter = List.of("coordinated", "minor").contains(scenario)
        ? wrap(m.pelvisBefore + delta)
        : m.pelvisBefore;
      m.classification = switch (scenario) {
        case "disconnect" -> "UNKNOWN";
        case "partial" -> "PARTIAL_TORSO_MOVEMENT";
        case "coordinated" -> "COORDINATED_TURN_CANDIDATE";
        default -> "SMALL_ADJUSTMENT";
      };
      m.quality = scenario.equals("disconnect")
        ? "PELVIS_DISCONNECTED"
        : "SIMULATED_GOOD";
      m.confidence = scenario.equals("disconnect") ? null : .85;
      m.sampleIds = scenario.equals("disconnect")
        ? List.of(m.id + "-chest")
        : List.of(m.id + "-chest", m.id + "-pelvis");
      return m;
    }

    private double wrap(double value) {
      return ((value + 180) % 360) - 180;
    }
  }
}
