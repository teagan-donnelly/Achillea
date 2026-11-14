package care.achillea;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import static care.achillea.Model.*;
public interface SensorAdapter {
 Movement sample(String scenario,Movement previous);
 class Simulator implements SensorAdapter {
  public Movement sample(String scenario,Movement previous) {
   Movement m=new Movement();m.id=UUID.randomUUID().toString();m.patientId="synthetic-icu-01";m.capturedAt=Instant.now();m.chestBefore=previous==null?0:previous.chestAfter;m.pelvisBefore=previous==null?0:previous.pelvisAfter;
   m.chestAfter=List.of("partial","coordinated").contains(scenario)?m.chestBefore+35:m.chestBefore;m.pelvisAfter=scenario.equals("coordinated")?m.pelvisBefore+35:m.pelvisBefore;
   m.classification=switch(scenario){case "disconnect"->"UNKNOWN";case "partial"->"PARTIAL_TORSO_MOVEMENT";case "coordinated"->"COORDINATED_TURN_CANDIDATE";default->"SMALL_ADJUSTMENT";};
   m.quality=scenario.equals("disconnect")?"PELVIS_DISCONNECTED":"SIMULATED_GOOD";m.sampleIds=scenario.equals("disconnect")?List.of(m.id+"-chest"):List.of(m.id+"-chest",m.id+"-pelvis");return m;
  }
 }
}
