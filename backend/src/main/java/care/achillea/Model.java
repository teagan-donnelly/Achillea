package care.achillea;
import java.time.Instant;
import java.util.*;
public class Model {
 public static class State { public List<Patient> patients=new ArrayList<>(); public List<Task> tasks=new ArrayList<>(); public List<Vital> vitals=new ArrayList<>(); public List<OrientationSample> samples=new ArrayList<>(); public List<Movement> movements=new ArrayList<>(); public List<Chart> charts=new ArrayList<>(); public List<Event> events=new ArrayList<>(); }
 public record OrientationSample(String id,String sensorId,String patientId,String bodyRegion,double rollDegrees,Instant capturedAt,Instant receivedAt,String quality,String mode) {}
 public record Patient(String id,String name,String room,String unit,String summary,String nurseId,boolean repositionPlan) {}
 public static class Task { public String id,patientId,title,type,status="OPEN",priority="ROUTINE",source="SEEDED_CARE_PLAN",deferReason,verifiedBy,completedAt; public Instant dueAt; public boolean verificationRequired; public int order; public Task() {} public Task(String id,String patientId,String title,String type,Instant dueAt,boolean verify,int order) {this.id=id;this.patientId=patientId;this.title=title;this.type=type;this.dueAt=dueAt;this.verificationRequired=verify;this.order=order;} }
 public record Vital(String id,String patientId,String metric,double value,String unit,Instant observedAt,Instant receivedAt,String source,String sourceEventId,String quality) {}
 public static class Movement {public String id,patientId,classification,quality,verificationStatus="UNREVIEWED",reviewerId,reviewedAt; public double chestBefore,pelvisBefore,chestAfter,pelvisAfter; public Instant capturedAt; public List<String> sampleIds;}
 public static class Chart {public String id,patientId,nurseId="nurse-demo",type,text,status="DRAFT",linkedTaskId,linkedMovementId,amendmentOfId; public List<String> linkedVitalIds=new ArrayList<>(); public Instant authoredAt,confirmedAt; public String provenance="MANUAL_ENTRY";}
 public record Event(String id,String patientId,String type,String source,String details,Instant timestamp) {}
 public record Draft(String patientId,String type,String text,String linkedTaskId,List<String> linkedVitalIds,String linkedMovementId) {}
 public record Observation(String sourceEventId,String patientId,String metric,double value,String unit,Instant observedAt,String quality) {}
 public record Command(String reason,String text,Boolean verified,String movementId,String status,Integer order,String priority) {}
 public record Round(Task task,String reason,int rank) {}
}
