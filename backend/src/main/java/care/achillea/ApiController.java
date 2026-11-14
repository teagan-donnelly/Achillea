package care.achillea;
import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.*;
import static care.achillea.Model.*;
@RestController @RequestMapping("/api")
public class ApiController {
 private final CareService service;private final boolean demo;
 public ApiController(CareService service,@Value("${app.demo-mode}")boolean demo){this.service=service;this.demo=demo;}
 void demo(){if(!demo)throw new ResponseStatusException(HttpStatus.FORBIDDEN,"Demo mode is disabled");}
 @GetMapping("/health") public Object health(){return Map.of("status","UP","version","0.1.0","synthetic",true);}
 @GetMapping("/state") public State state(){demo();return service.read();}
 @GetMapping("/demo/context") public Object context(){return Map.of("demoMode",demo,"nurseId","nurse-demo","nurseName","Jordan Ellis, RN","synthetic",true);}
 @GetMapping("/patients") public Object patients(@RequestParam(defaultValue="L_AND_D")String unit,@RequestParam(defaultValue="")String query){demo();return service.read().patients.stream().filter(p->p.unit().equals(unit)&&(p.name()+p.room()+p.id()).toLowerCase().contains(query.toLowerCase())).toList();}
 @GetMapping("/patients/{id}") public Object patient(@PathVariable String id){demo();return service.patient(service.read(),id);}
 @GetMapping("/patients/{id}/vitals") public Object vitals(@PathVariable String id,@RequestParam(defaultValue="100")int limit){demo();State s=service.read();service.patient(s,id);return s.vitals.stream().filter(v->v.patientId().equals(id)).sorted(Comparator.comparing(Vital::observedAt).reversed()).limit(Math.max(1,Math.min(limit,500))).toList();}
 @GetMapping("/patients/{id}/tasks") public Object tasks(@PathVariable String id){demo();State s=service.read();service.patient(s,id);return s.tasks.stream().filter(t->t.patientId.equals(id)).toList();}
 @GetMapping("/patients/{id}/chart") public Object charts(@PathVariable String id){demo();State s=service.read();service.patient(s,id);return s.charts.stream().filter(c->c.patientId.equals(id)).toList();}
 @GetMapping("/patients/{id}/orientation") public Object orientation(@PathVariable String id){demo();State s=service.read();service.patient(s,id);return Map.of("samples",s.samples.stream().filter(x->x.patientId().equals(id)).toList(),"movements",s.movements.stream().filter(m->m.patientId.equals(id)).toList(),"mode","SIMULATED");}
 @GetMapping("/events") public Object events(@RequestParam(required=false)String patientId,@RequestParam(defaultValue="")String type,@RequestParam(defaultValue="100")int limit){demo();State s=service.read();if(patientId!=null)service.patient(s,patientId);return s.events.stream().filter(e->(patientId==null||patientId.equals(e.patientId()))&&e.type().startsWith(type)).sorted(Comparator.comparing(Event::timestamp).reversed()).limit(Math.max(1,Math.min(limit,500))).toList();}
 @GetMapping("/rounds") public Object rounds(@RequestParam(defaultValue="L_AND_D")String unit){demo();return service.rounds(service.read(),unit);}
 @PostMapping("/chart/drafts") public Object draft(@RequestBody Draft d){demo();return service.draft(d,null,null);}
 @PatchMapping("/chart/drafts/{id}") public Object edit(@PathVariable String id,@RequestBody Draft d){demo();return service.draft(d,id,null);}
 @PostMapping("/chart/drafts/{id}/confirm") public Object confirm(@PathVariable String id,@RequestBody Command c){demo();return service.confirm(id,c);}
 @PostMapping("/chart/{id}/amendments") public Object amend(@PathVariable String id,@RequestBody Draft d){demo();return service.draft(d,null,id);}
 @PostMapping("/tasks/{id}/{action}") public Object task(@PathVariable String id,@PathVariable String action,@RequestBody Command c){demo();return service.taskCommand(id,action,c);}
 @PostMapping("/movements/{id}/review") public Object review(@PathVariable String id,@RequestBody Command c){demo();return service.review(id,c);}
 @PostMapping("/demo/reset") public Object reset(){demo();return service.reset();}
 @PostMapping("/integrations/monitors/observations") public Object ingest(@RequestBody Observation observation){demo();return service.ingest(observation);}
 @PostMapping("/demo/scenarios/{key}") public Object scenario(@PathVariable String key,@RequestParam(required=false)String patientId){demo();return service.scenario(key,patientId);}
 @PostMapping("/rounds/explanation") public Object explanation(@RequestParam(defaultValue="L_AND_D")String unit){demo();return Map.of("source","DETERMINISTIC","summary","Explicit high priority, then overdue, due within 30 minutes, then nurse-ordered routine tasks.","rounds",service.rounds(service.read(),unit));}
}
@RestControllerAdvice
class ApiErrors {
 @ExceptionHandler(ResponseStatusException.class) ResponseEntity<?> status(ResponseStatusException e){return ResponseEntity.status(e.getStatusCode()).body(Map.of("code",e.getStatusCode().value(),"message",Objects.toString(e.getReason(),"Request failed"),"timestamp",Instant.now(),"correlationId",UUID.randomUUID()));}
 @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class) ResponseEntity<?> invalid(Exception e){return ResponseEntity.badRequest().body(Map.of("code",400,"message","Invalid request body","timestamp",Instant.now(),"correlationId",UUID.randomUUID()));}
}
