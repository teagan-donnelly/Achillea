import java.io.*;
// Reads a password from stdin; never stores it, logs it, or embeds it in a URL.
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;

class VerifyTiger {

  public static void main(String[] args) throws Exception {
    if (args.length < 3) throw new IllegalArgumentException(
      "Usage: JDBC_URL USER inspect|migrate [migration-directory]. Password is read from stdin."
    );
    String password =
      System.console() != null
        ? new String(System.console().readPassword("Database password: "))
        : new BufferedReader(new InputStreamReader(System.in)).readLine();
    Properties properties = new Properties();
    properties.setProperty("user", args[1]);
    properties.setProperty("password", password);
    try (Connection c = DriverManager.getConnection(args[0], properties)) {
      System.out.println(
        "Connected to PostgreSQL " +
          c.getMetaData().getDatabaseMajorVersion() +
          " with TLS verification requested."
      );
      try (
        Statement q = c.createStatement();
        ResultSet r = q.executeQuery(
          "select ssl from pg_stat_ssl where pid=pg_backend_pid()"
        )
      ) {
        if (!r.next() || !r.getBoolean(1)) throw new IllegalStateException(
          "Connection is not encrypted"
        );
        System.out.println("TLS encrypted connection confirmed.");
      }
      List<String> tables = new ArrayList<>();
      try (
        Statement q = c.createStatement();
        ResultSet r = q.executeQuery(
          "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('public','achillea') and table_type='BASE TABLE' order by 1"
        )
      ) {
        while (r.next()) tables.add(r.getString(1));
      }
      System.out.println("Application-visible tables: " + tables);
      if (args[2].equals("migrate")) {
        if (
          tables.stream().anyMatch(t -> t.startsWith("achillea.")) &&
          !tables.contains("achillea.flyway_schema_history")
        ) throw new IllegalStateException(
          "Refusing migration into nonempty unmanaged schema"
        );
      }
    }
    if (args[2].equals("migrate")) {
      var result = Flyway.configure()
        .dataSource(args[0], args[1], password)
        .defaultSchema("achillea")
        .schemas("achillea")
        .createSchemas(true)
        .cleanDisabled(true)
        .locations("filesystem:" + args[3])
        .load()
        .migrate();
      System.out.println(
        "Applied " +
          result.migrationsExecuted +
          " migrations in dedicated achillea schema; no demo reset or seed performed."
      );
    }
  }
}
