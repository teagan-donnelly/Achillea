// Non-destructive hosted smoke test: seeds only if empty; never invokes reset/confirmation.
// Password is read without terminal echo. Endpoint key exists only for this process.
import java.io.*;
import java.util.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.security.SecureRandom;
import org.springframework.boot.*;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.core.env.MapPropertySource;
import com.fasterxml.jackson.databind.*;
import care.achillea.*;
class VerifyTigerApplication {
 static Map<String,Object> settings;
 static org.springframework.context.ConfigurableApplicationContext start(){SpringApplication app=new SpringApplication(Application.class);app.addInitializers(ctx->ctx.getEnvironment().getPropertySources().addFirst(new MapPropertySource("cloud-verification",settings)));return app.run();}
 public static void main(String[] args)throws Exception {
  if(args.length!=2)throw new IllegalArgumentException("JDBC_URL USER required; password is read from console");
  String password=new String(System.console().readPassword("Database password: "));byte[] random=new byte[32];new SecureRandom().nextBytes(random);String key=Base64.getUrlEncoder().withoutPadding().encodeToString(random);
  settings=new HashMap<>(Map.of("spring.datasource.url",args[0],"spring.datasource.username",args[1],"spring.datasource.password",password,"server.port","0","app.demo.seed","true","app.demo.allow-reset","false","app.monitor.enabled","false","app.simulation.enabled","true","app.simulation.key",key,"logging.level.root","ERROR"));settings.put("spring.datasource.hikari.data-source-properties.sslmode","verify-full");settings.put("logging.level.org.springframework","ERROR");settings.put("debug","false");
  String encounter="encounter-synthetic-icu-01",source="cloud-smoke",run="verify-"+UUID.randomUUID();String receipt;
  try(var ctx=start()){
   SimulationService service=ctx.getBean(SimulationService.class);service.bind(source,encounter);int port=((ServletWebServerApplicationContext)ctx).getWebServer().getPort();String base="http://127.0.0.1:"+port+"/api/integrations/simulation/v1";ObjectMapper json=ctx.getBean(ObjectMapper.class);HttpClient http=HttpClient.newHttpClient();
   String payload=json.writeValueAsString(Map.of("schemaVersion",1,"encounterId",encounter,"sourceId",source,"runId",run,"timeScale",600,"samples",List.of(Map.of("eventId","baseline","timestamp","2040-01-01T00:00:00Z","chest",axes(0),"pelvis",axes(0)),Map.of("eventId","movement","timestamp","2040-01-01T00:00:02Z","chest",axes(40),"pelvis",axes(40)))));
   var request=HttpRequest.newBuilder(URI.create(base+"/observations")).header("Content-Type","application/json").header("X-Simulation-Key",key).POST(HttpRequest.BodyPublishers.ofString(payload)).build();
   var response=http.send(request,HttpResponse.BodyHandlers.ofString());if(response.statusCode()!=200)throw new IllegalStateException("Ingestion HTTP "+response.statusCode()+": "+response.body());JsonNode ack=json.readTree(response.body());if(ack.path("accepted").asInt()!=2||!ack.path("patientId").asText().equals("synthetic-icu-01"))throw new IllegalStateException("Ingestion identity mismatch");receipt=ack.path("results").get(1).path("receiptId").asText();
   var replay=http.send(request,HttpResponse.BodyHandlers.ofString());if(json.readTree(replay.body()).path("duplicates").asInt()!=2)throw new IllegalStateException("Deduplication failed");
   var history=http.send(HttpRequest.newBuilder(URI.create(base+"/processed?encounterId="+encounter+"&sourceId="+source)).header("X-Simulation-Key",key).GET().build(),HttpResponse.BodyHandlers.ofString());if(history.statusCode()!=200||!json.readTree(history.body()).path("patientId").asText().equals("synthetic-icu-01"))throw new IllegalStateException("Processed retrieval failed");
   System.out.println("HOSTED_SMOKE: HTTP ingestion accepted 2 packets, replay returned 2 duplicates, patient-scoped processed retrieval succeeded.");
  }
  settings.put("app.demo.seed","false");
  try(var ctx=start()){
   var store=ctx.getBean(RelationalStore.class);if(store.jdbc().queryForObject("select count(*) from ingestion_receipts where id=?",Integer.class,receipt)!=1)throw new IllegalStateException("Receipt did not survive application restart");if(store.jdbc().queryForObject("select count(*) from raw_imu_samples where receipt_id=?",Integer.class,receipt)!=2)throw new IllegalStateException("Raw evidence missing after restart");System.out.println("HOSTED_RESTART: receipt and both raw regions survived a full Spring application context restart. No care was confirmed or completed.");
  }
 }
 static Map<String,Double> axes(double degrees){double r=Math.toRadians(degrees);return Map.of("ax",0d,"ay",Math.sin(r),"az",Math.cos(r),"gx",0d,"gy",0d,"gz",0d);}
}
