package care.achillea;
/** Starts only a disposable native PostgreSQL database for the frontend HTTP suite. */
public class LocalIntegrationServer extends PostgresTestSupport {
 public static void main(String[] args)throws Exception{
  String url=databaseUrl(),schema=url.substring(url.indexOf("currentSchema=")+14);
  try(var context=new org.springframework.boot.builder.SpringApplicationBuilder(Application.class).run("--server.port=18089","--spring.datasource.url="+url,"--spring.datasource.username=postgres","--spring.datasource.password=postgres","--spring.datasource.hikari.schema="+schema,"--spring.flyway.default-schema="+schema,"--spring.flyway.schemas="+schema,"--spring.datasource.hikari.data-source-properties.sslmode=disable","--app.demo.seed=true","--app.demo.allow-reset=true","--app.monitor.enabled=false","--app.simulation.enabled=true","--app.simulation.key=local-integration-only-key-12345","--app.simulation.bindings=simulator-001=encounter-synthetic-icu-01","--logging.level.root=ERROR","--logging.level.org.springframework=ERROR")){
   System.out.println("DISPOSABLE_HTTP_READY http://127.0.0.1:18089");for(int i=0;i<300&&!java.nio.file.Files.exists(java.nio.file.Path.of("backend/target/local-http.stop"));i++)Thread.sleep(2000);
  }
 }
}
