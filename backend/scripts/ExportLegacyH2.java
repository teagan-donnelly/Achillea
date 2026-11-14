import java.nio.file.*;
// Standalone read-only exporter, NOT part of the Spring application/runtime.
// java -cp /path/to/h2.jar backend/scripts/ExportLegacyH2.java ABSOLUTE_DB_BASE OUTPUT_JSON
import java.sql.*;

class ExportLegacyH2 {

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException(
      "Expected absolute H2 database base path and new output JSON path"
    );
    Path database = Path.of(args[0]).toAbsolutePath().normalize(),
      output = Path.of(args[1]).toAbsolutePath();
    if (Files.exists(output)) throw new IllegalArgumentException(
      "Refusing to overwrite output"
    );
    try (
      Connection connection = DriverManager.getConnection(
        "jdbc:h2:file:" +
          database.toString().replace('\\', '/') +
          ";IFEXISTS=TRUE;ACCESS_MODE_DATA=r",
        "sa",
        ""
      );
      Statement statement = connection.createStatement();
      ResultSet records = statement.executeQuery(
        "select payload from store where id='demo'"
      )
    ) {
      if (!records.next()) throw new IllegalStateException(
        "No demo aggregate found"
      );
      Files.writeString(
        output,
        records.getString(1),
        StandardOpenOption.CREATE_NEW
      );
      System.out.println(
        "Exported synthetic aggregate without modifying H2. Keep source backup; import into an empty PostgreSQL schema explicitly."
      );
    }
  }
}
