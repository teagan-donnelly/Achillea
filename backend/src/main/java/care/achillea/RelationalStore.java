package care.achillea;

import static care.achillea.Model.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.*;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Persists the demo aggregate in one H2 table per record type (see schema.sql).
 *
 * <p>CareService still works on an in-memory {@link State}; this class maps it to rows. Saves are
 * diff-based against the last loaded/saved snapshot, so a command writes only the rows it changed,
 * inside one transaction. Lists on records (movement sample IDs, reason codes, chart evidence) live
 * in ordered child tables.
 */
@Repository
public class RelationalStore {

  private static final Logger log = LoggerFactory.getLogger(RelationalStore.class);

  /** One persisted column backed by a model field or record component. */
  record Prop(String column, Class<?> type, Function<Object, Object> getter) {}

  /** A List&lt;String&gt; field stored in an ordered child table. */
  record Child(String table, String column, String field) {}

  record Kind(String table, Class<?> type, String collection, List<Child> children) {}

  /** Parent tables first: inserts run in this order, deletes in reverse. */
  static final List<Kind> KINDS = List.of(
    new Kind("patients", Patient.class, "patients", List.of()),
    new Kind("devices", Device.class, "devices", List.of()),
    new Kind("care_tasks", Task.class, "tasks", List.of()),
    new Kind("vital_observations", Vital.class, "vitals", List.of()),
    new Kind("orientation_samples", OrientationSample.class, "samples", List.of()),
    new Kind(
      "movement_candidates",
      Movement.class,
      "movements",
      List.of(
        new Child("movement_sample_links", "sample_id", "sampleIds"),
        new Child("movement_reason_codes", "code", "reviewReasonCodes")
      )
    ),
    new Kind(
      "chart_entries",
      Chart.class,
      "charts",
      List.of(new Child("chart_evidence_links", "vital_id", "linkedVitalIds"))
    ),
    new Kind("activity_events", Event.class, "events", List.of())
  );

  private final JdbcTemplate jdbc;
  private final TransactionTemplate tx;
  private final ObjectMapper json;
  private final Map<Class<?>, List<Prop>> props = new HashMap<>();

  /** table -> id -> row signature as last seen in the database; null = unknown, re-read first. */
  private Map<String, Map<String, List<Object>>> snapshot;
  private boolean legacyChecked;

  public RelationalStore(JdbcTemplate jdbc, TransactionTemplate tx, ObjectMapper json) {
    this.jdbc = jdbc;
    this.tx = tx;
    this.json = json;
    for (Kind k : KINDS) props.put(k.type, describe(k.type));
  }

  // ---------------------------------------------------------------- public API

  /** The stored aggregate, or empty when the database has never been seeded. */
  public synchronized Optional<State> load() {
    importLegacyOnce();
    List<Map<String, Object>> meta = jdbc.queryForList(
      "select started_at, monitor_tick from demo_metadata where id='demo'"
    );
    if (meta.isEmpty()) {
      snapshot = emptySnapshot();
      return Optional.empty();
    }
    State s = new State();
    Map<String, Map<String, List<Object>>> seen = emptySnapshot();
    for (Kind k : KINDS) {
      Map<String, Map<String, List<String>>> children = new HashMap<>();
      for (Child c : k.children) children.put(c.field, readChild(c));
      List<Object> records = jdbc.query(
        "select * from " + k.table + " order by list_order, id",
        (rs, n) -> build(k, rs, children)
      );
      collection(s, k).addAll(records);
      for (int i = 0; i < records.size(); i++) {
        Object r = records.get(i);
        seen.get(k.table).put(id(k, r), signature(k, r, i));
      }
    }
    jdbc.query(
      "select started_at, monitor_tick from demo_metadata where id='demo'",
      rs -> {
        s.demoStartedAt = instant(rs, "started_at");
        s.monitorTick = rs.getLong("monitor_tick");
      }
    );
    snapshot = seen;
    return Optional.of(s);
  }

  /** Writes only rows that differ from the database, atomically. */
  public synchronized void save(State s) {
    if (snapshot == null) load();
    try {
      Map<String, Map<String, List<Object>>> next = tx.execute(status -> write(s));
      snapshot = next;
    } catch (RuntimeException e) {
      snapshot = null; // database state unknown after a failed transaction; re-read next time
      throw e;
    }
  }

  // ---------------------------------------------------------------- writing

  private Map<String, Map<String, List<Object>>> write(State s) {
    jdbc.update(
      "merge into demo_metadata (id, started_at, monitor_tick) key(id) values ('demo', ?, ?)",
      sql(s.demoStartedAt),
      s.monitorTick
    );
    Map<String, Map<String, List<Object>>> next = emptySnapshot();
    for (Kind k : KINDS) {
      List<Prop> cols = props.get(k.type);
      Map<String, List<Object>> before = snapshot.get(k.table);
      List<Object> records = collection(s, k);
      List<Object[]> upserts = new ArrayList<>();
      List<Object> changedOwners = new ArrayList<>();
      for (int i = 0; i < records.size(); i++) {
        Object r = records.get(i);
        String id = id(k, r);
        List<Object> sig = signature(k, r, i);
        next.get(k.table).put(id, sig);
        if (sig.equals(before.get(id))) continue;
        Object[] args = new Object[cols.size() + 1];
        for (int c = 0; c < cols.size(); c++) args[c] = sql(cols.get(c).getter.apply(r));
        args[cols.size()] = i;
        upserts.add(args);
        changedOwners.add(r);
      }
      if (!upserts.isEmpty()) {
        StringJoiner names = new StringJoiner(", ");
        StringJoiner marks = new StringJoiner(", ");
        cols.forEach(p -> {
          names.add(p.column);
          marks.add("?");
        });
        jdbc.batchUpdate(
          "merge into " + k.table + " (" + names + ", list_order) key(id) values (" + marks + ", ?)",
          upserts
        );
      }
      for (Child c : k.children) writeChildren(k, c, changedOwners);
    }
    for (Kind k : KINDS.reversed()) {
      List<Object[]> gone = snapshot
        .get(k.table)
        .keySet()
        .stream()
        .filter(id -> !next.get(k.table).containsKey(id))
        .map(id -> new Object[] { id })
        .toList();
      if (!gone.isEmpty()) jdbc.batchUpdate("delete from " + k.table + " where id=?", gone);
    }
    return next;
  }

  private void writeChildren(Kind k, Child c, List<Object> owners) {
    if (owners.isEmpty()) return;
    List<Object[]> clear = new ArrayList<>();
    List<Object[]> rows = new ArrayList<>();
    for (Object owner : owners) {
      String id = id(k, owner);
      clear.add(new Object[] { id });
      List<String> values = list(owner, c.field);
      for (int p = 0; p < values.size(); p++) rows.add(new Object[] { id, p, values.get(p) });
    }
    jdbc.batchUpdate("delete from " + c.table + " where owner_id=?", clear);
    if (!rows.isEmpty()) jdbc.batchUpdate(
      "insert into " + c.table + " (owner_id, position, " + c.column + ") values (?, ?, ?)",
      rows
    );
  }

  // ---------------------------------------------------------------- reading

  private Map<String, List<String>> readChild(Child c) {
    Map<String, List<String>> out = new HashMap<>();
    jdbc.query(
      "select owner_id, " + c.column + " from " + c.table + " order by owner_id, position",
      rs -> {
        out.computeIfAbsent(rs.getString(1), x -> new ArrayList<>()).add(rs.getString(2));
      }
    );
    return out;
  }

  private Object build(Kind k, ResultSet rs, Map<String, Map<String, List<String>>> children)
    throws SQLException {
    List<Prop> cols = props.get(k.type);
    Object[] values = new Object[cols.size()];
    for (int i = 0; i < cols.size(); i++) values[i] = read(rs, cols.get(i));
    try {
      Object r;
      if (k.type.isRecord()) {
        Class<?>[] types = Arrays.stream(k.type.getRecordComponents())
          .map(RecordComponent::getType)
          .toArray(Class<?>[]::new);
        r = k.type.getDeclaredConstructor(types).newInstance(values);
      } else {
        r = k.type.getDeclaredConstructor().newInstance();
        for (int i = 0; i < cols.size(); i++) {
          Field f = k.type.getField(fieldName(cols.get(i).column, k.type));
          f.set(r, values[i]);
        }
        String id = (String) k.type.getField("id").get(r);
        for (Child c : k.children) k.type
          .getField(c.field)
          .set(r, new ArrayList<>(children.get(c.field).getOrDefault(id, List.of())));
      }
      return r;
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException("Cannot map row of " + k.table, e);
    }
  }

  private Object read(ResultSet rs, Prop p) throws SQLException {
    Class<?> t = p.type;
    String c = p.column;
    if (t == String.class) return rs.getString(c);
    if (t == Instant.class) return instant(rs, c);
    if (t == boolean.class) return rs.getBoolean(c);
    if (t == int.class) return rs.getInt(c);
    if (t == long.class) return rs.getLong(c);
    if (t == double.class) return rs.getDouble(c);
    Object o = rs.getObject(c);
    if (o == null) return null;
    if (t == Double.class) return ((Number) o).doubleValue();
    if (t == Integer.class) return ((Number) o).intValue();
    if (t == Long.class) return ((Number) o).longValue();
    if (t == Boolean.class) return o;
    throw new IllegalStateException("Unsupported column type " + t + " for " + c);
  }

  private static Instant instant(ResultSet rs, String column) throws SQLException {
    OffsetDateTime t = rs.getObject(column, OffsetDateTime.class);
    return t == null ? null : t.toInstant();
  }

  // ---------------------------------------------------------------- legacy JSON import

  /** Copies an old single-row JSON database (table STORE) into the relational tables once. */
  private void importLegacyOnce() {
    if (legacyChecked) return;
    legacyChecked = true;
    Integer seeded = jdbc.queryForObject("select count(*) from demo_metadata", Integer.class);
    Integer legacy = jdbc.queryForObject(
      "select count(*) from information_schema.tables where upper(table_name)='STORE'",
      Integer.class
    );
    if (seeded == null || seeded > 0 || legacy == null || legacy == 0) return;
    List<String> payload = jdbc.queryForList(
      "select payload from store where id='demo'",
      String.class
    );
    if (payload.isEmpty() || payload.getFirst() == null || payload.getFirst().isBlank()) return;
    try {
      State s = json.readValue(payload.getFirst(), State.class);
      snapshot = emptySnapshot();
      save(s);
      log.info(
        "Imported legacy JSON demo database into relational tables ({} patients, {} vitals, {} events). Table STORE left untouched.",
        s.patients.size(),
        s.vitals.size(),
        s.events.size()
      );
    } catch (Exception e) {
      throw new IllegalStateException("Cannot import legacy demo database", e);
    }
  }

  // ---------------------------------------------------------------- reflection helpers

  private static List<Prop> describe(Class<?> type) {
    List<Prop> out = new ArrayList<>();
    if (type.isRecord()) {
      for (RecordComponent rc : type.getRecordComponents()) {
        Method m = rc.getAccessor();
        out.add(new Prop(column(rc.getName()), rc.getType(), o -> invoke(m, o)));
      }
    } else {
      for (Field f : type.getFields()) {
        if (Modifier.isStatic(f.getModifiers()) || List.class.isAssignableFrom(f.getType())) continue;
        out.add(new Prop(column(f.getName()), f.getType(), o -> get(f, o)));
      }
      out.sort(Comparator.comparing(p -> !p.column.equals("id"))); // keep id first for readability
    }
    return out;
  }

  /** Field name to column; a few names are reserved words in H2. */
  static String column(String field) {
    return switch (field) {
      case "value" -> "measured_value";
      case "order" -> "sort_order";
      case "timestamp" -> "occurred_at";
      default -> field.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
    };
  }

  private static String fieldName(String column, Class<?> type) {
    for (Field f : type.getFields()) if (column(f.getName()).equals(column)) return f.getName();
    throw new IllegalStateException("No field for column " + column);
  }

  private List<Object> signature(Kind k, Object r, int index) {
    List<Object> sig = new ArrayList<>();
    for (Prop p : props.get(k.type)) sig.add(p.getter.apply(r));
    sig.add(index);
    for (Child c : k.children) sig.add(List.copyOf(list(r, c.field)));
    return sig;
  }

  private String id(Kind k, Object r) {
    return (String) props.get(k.type).stream()
      .filter(p -> p.column.equals("id"))
      .findFirst()
      .orElseThrow()
      .getter.apply(r);
  }

  @SuppressWarnings("unchecked")
  private static List<String> list(Object r, String field) {
    try {
      List<String> v = (List<String>) r.getClass().getField(field).get(r);
      return v == null ? List.of() : v;
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  @SuppressWarnings("unchecked")
  private static List<Object> collection(State s, Kind k) {
    try {
      return (List<Object>) State.class.getField(k.collection).get(s);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private static Map<String, Map<String, List<Object>>> emptySnapshot() {
    Map<String, Map<String, List<Object>>> m = new HashMap<>();
    for (Kind k : KINDS) m.put(k.table, new HashMap<>());
    return m;
  }

  private static Object sql(Object v) {
    return v instanceof Instant i ? OffsetDateTime.ofInstant(i, ZoneOffset.UTC) : v;
  }

  private static Object invoke(Method m, Object o) {
    try {
      return m.invoke(o);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  private static Object get(Field f, Object o) {
    try {
      return f.get(o);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }
}
