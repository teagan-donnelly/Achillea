package care.achillea;

import static care.achillea.Model.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Typed JDBC rows; DTO materialization is scoped. No JSON is stored in the database. */
@Repository
public class RelationalStore {

  final JdbcTemplate jdbc;

  public JdbcTemplate jdbc() {
    return jdbc;
  }

  private final ObjectMapper json;

  record Kind(String table, Class<?> type, String collection) {}

  private static final List<Kind> KINDS = List.of(
    new Kind("patients", Patient.class, "patients"),
    new Kind("devices", Device.class, "devices"),
    new Kind("movement_candidates", Movement.class, "movements"),
    new Kind("care_tasks", Task.class, "tasks"),
    new Kind("vital_observations", Vital.class, "vitals"),
    new Kind("orientation_samples", OrientationSample.class, "samples"),
    new Kind("chart_entries", Chart.class, "charts"),
    new Kind("activity_events", Event.class, "events")
  );

  public RelationalStore(JdbcTemplate jdbc, ObjectMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  private static String column(String name) {
    return name.equals("order")
      ? "sort_order"
      : name.equals("timestamp")
        ? "occurred_at"
        : name.replaceAll("([a-z])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
  }

  private static List<Field> fields(Class<?> c) {
    return Arrays.stream(c.getDeclaredFields())
      .filter(
        f ->
          !Modifier.isStatic(f.getModifiers()) &&
          !List.class.isAssignableFrom(f.getType())
      )
      .toList();
  }

  private String signature(Object o) {
    try {
      return json.writeValueAsString(o);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private Object value(Field f, Object object) {
    try {
      f.setAccessible(true);
      return f.get(object);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private Object sqlValue(Object v) {
    return v instanceof Instant i ? Timestamp.from(i) : v;
  }

  @SuppressWarnings("unchecked")
  private List<Object> collection(State s, Kind k) {
    try {
      return (List<Object>) State.class.getField(k.collection).get(s);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  public String encounter(String patient) {
    List<String> ids = jdbc.queryForList(
      "select id from encounters where patient_id=? and active",
      String.class,
      patient
    );
    if (ids.isEmpty()) throw new ResponseStatusException(
      HttpStatus.NOT_FOUND,
      "Active synthetic encounter not found"
    );
    return ids.getFirst();
  }

  public void lockPatient(String patient) {
    jdbc.queryForList(
      "select id from encounters where patient_id=? and active order by id for update",
      String.class,
      patient
    );
  }

  public void lockAll() {
    jdbc.queryForList(
      "select id from encounters order by id for update",
      String.class
    );
  }

  public String owner(String table, String id) {
    if (
      KINDS.stream().noneMatch(k -> k.table.equals(table))
    ) throw new IllegalArgumentException("Unknown repository");
    List<String> p = jdbc.queryForList(
      "select patient_id from " + table + " where id=?",
      String.class,
      id
    );
    if (p.isEmpty()) throw new ResponseStatusException(
      HttpStatus.NOT_FOUND,
      "Record not found"
    );
    String pid = p.getFirst();
    String active = encounter(pid);
    String stored = jdbc.queryForObject(
      "select encounter_id from " + table + " where id=?",
      String.class,
      id
    );
    if (!active.equals(stored)) throw new ResponseStatusException(
      HttpStatus.CONFLICT,
      "Record belongs to a closed encounter"
    );
    return pid;
  }

  public State load(
    String patient,
    String unit,
    boolean evidence,
    Instant since
  ) {
    return load(patient, unit, evidence, since, null);
  }

  public State load(
    String patient,
    String unit,
    boolean evidence,
    Instant since,
    Set<String> selected
  ) {
    State s = new State();
    jdbc.query(
      "select started_at,monitor_tick from demo_metadata where id='demo'",
      rs -> {
        s.demoStartedAt = rs.getTimestamp(1).toInstant();
        s.monitorTick = rs.getLong(2);
      }
    );
    for (Kind k : KINDS) {
      if (selected != null && !selected.contains(k.table)) continue;
      boolean history = Set.of(
        "vital_observations",
        "orientation_samples",
        "activity_events"
      ).contains(k.table);
      if (history && !evidence) continue;
      String alias = k.table.equals("patients") ? "r.id" : "r.patient_id";
      StringBuilder sql = new StringBuilder(
        "select r.* from " + k.table + " r where 1=1"
      );
      List<Object> args = new ArrayList<>();
      if (!k.table.equals("patients")) sql.append(
        " and (r.encounter_id in(select id from encounters where active)" +
          (k.table.equals("activity_events")
            ? " or r.encounter_id is null"
            : "") +
          ")"
      );
      if (patient != null) {
        sql.append(" and " + alias + "=?");
        args.add(patient);
      }
      if (unit != null) {
        sql.append(
          " and (" +
            alias +
            " in(select id from patients where unit=? and nurse_id='nurse-demo')" +
            (k.table.equals("activity_events")
              ? " or r.patient_id is null"
              : "") +
            ")"
        );
        args.add(unit);
      }
      if (since != null && history) {
        sql.append(
          " and r." +
            (k.table.equals("activity_events")
              ? "occurred_at"
              : "received_at") +
            ">=?"
        );
        args.add(Timestamp.from(since));
      }
      sql.append(
        " order by " +
          switch (k.table) {
            case "vital_observations" -> "r.observed_at,r.id";
            case
              "orientation_samples",
              "movement_candidates" -> "r.captured_at,r.id";
            case "activity_events" -> "r.occurred_at,r.id";
            case "chart_entries" -> "r.authored_at,r.id";
            case "patients" -> "r.display_order,r.id";
            default -> "r.id";
          }
      );
      List<Object> rows = jdbc.query(
        sql.toString(),
        (rs, n) -> {
          Map<String, Object> data = new HashMap<>();
          for (Field f : fields(k.type)) {
            Object v = rs.getObject(column(f.getName()));
            if (v instanceof Timestamp t) v = t.toInstant().toString();
            if (v instanceof OffsetDateTime t) v = t.toInstant().toString();
            data.put(f.getName(), v);
          }
          Object item = json.convertValue(data, k.type);
          String id = (String) data.get("id");
          if (item instanceof Movement m) {
            m.sampleIds = links("movement_sample_links", id);
            m.reviewReasonCodes = links("movement_reason_codes", id);
          }
          if (item instanceof Chart c) c.linkedVitalIds = links(
            "chart_evidence_links",
            id
          );
          s.persisted.put(k.table + ":" + id, signature(item));
          return item;
        },
        args.toArray()
      );
      collection(s, k).addAll(rows);
    }
    return s;
  }

  public List<Vital> vitalHistory(
    String patient,
    String metric,
    Instant from,
    Instant to,
    int limit
  ) {
    String sql =
      "select * from vital_observations where patient_id=? and encounter_id in(select id from encounters where active)";
    List<Object> args = new ArrayList<>();
    args.add(patient);
    if (metric != null) {
      sql += " and metric=?";
      args.add(metric);
    }
    if (from != null) {
      sql += " and observed_at>=?";
      args.add(Timestamp.from(from));
    }
    if (to != null) {
      sql += " and observed_at<=?";
      args.add(Timestamp.from(to));
    }
    sql += " order by observed_at desc,id limit ?";
    args.add(Math.max(1, Math.min(limit, 500)));
    return jdbc.query(
      sql,
      (r, n) ->
        new Vital(
          r.getString("id"),
          r.getString("patient_id"),
          r.getString("metric"),
          r.getDouble("value"),
          r.getString("unit"),
          r.getTimestamp("observed_at").toInstant(),
          r.getTimestamp("received_at").toInstant(),
          r.getString("source"),
          r.getString("source_event_id"),
          r.getString("quality"),
          r.getString("source_id")
        ),
      args.toArray()
    );
  }

  private List<String> links(String table, String id) {
    return new ArrayList<>(
      jdbc.queryForList(
        "select value from " + table + " where owner_id=? order by position",
        String.class,
        id
      )
    );
  }

  private void saveLinks(String table, String id, List<String> values) {
    jdbc.update("delete from " + table + " where owner_id=?", id);
    for (int i = 0; i < values.size(); i++) jdbc.update(
      "insert into " + table + "(owner_id,position,value) values(?,?,?)",
      id,
      i,
      values.get(i)
    );
  }

  public State save(State s) {
    Map<String, String> encounterIds = new HashMap<>();
    if (s.demoStartedAt != null) jdbc.update(
      "insert into demo_metadata values('demo',?,?) on conflict(id) do update set monitor_tick=excluded.monitor_tick",
      Timestamp.from(s.demoStartedAt),
      s.monitorTick
    );
    for (Kind k : KINDS)
      for (Object item : collection(s, k)) {
        List<Field> fs = fields(k.type);
        String id = (String) value(
            fs
              .stream()
              .filter(f -> f.getName().equals("id"))
              .findFirst()
              .orElseThrow(),
            item
          ),
          key = k.table + ":" + id,
          sig = signature(item),
          before = s.persisted.get(key);
        if (sig.equals(before)) continue;
        if (item instanceof Patient p && p.nurseId() != null) jdbc.update(
          "insert into nurses values(?) on conflict do nothing",
          p.nurseId()
        );
        List<String> columns = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        for (Field f : fs) {
          columns.add(column(f.getName()));
          values.add(sqlValue(value(f, item)));
        }
        String pid = k.table.equals("patients")
          ? id
          : (String) value(
              fs
                .stream()
                .filter(f -> f.getName().equals("patientId"))
                .findFirst()
                .orElseThrow(),
              item
            );
        if (!k.table.equals("patients")) {
          columns.add("encounter_id");
          values.add(
            pid == null
              ? null
              : before != null
                ? jdbc.queryForObject(
                    "select encounter_id from " + k.table + " where id=?",
                    String.class,
                    id
                  )
                : encounterIds.computeIfAbsent(pid, this::encounter)
          );
        }
        if (item instanceof Patient) {
          columns.add("display_order");
          values.add(s.patients.indexOf(item));
        }
        String placeholders = String.join(
          ",",
          Collections.nCopies(columns.size(), "?")
        );
        if (before == null) jdbc.update(
          "insert into " +
            k.table +
            "(" +
            String.join(",", columns) +
            ") values(" +
            placeholders +
            ")",
          values.toArray()
        );
        else {
          String updates = String.join(
            ",",
            columns
              .stream()
              .filter(c -> !c.equals("id"))
              .map(c -> c + "=?")
              .toList()
          );
          List<Object> changed = new ArrayList<>(
            values.subList(1, values.size())
          );
          changed.add(id);
          jdbc.update(
            "update " + k.table + " set " + updates + " where id=?",
            changed.toArray()
          );
        }
        if (item instanceof Patient p) {
          String eid = "encounter-" + p.id();
          jdbc.update(
            "insert into encounters(id,patient_id) values(?,?) on conflict(id) do nothing",
            eid,
            p.id()
          );
          jdbc.update(
            "insert into care_assignments values(?,?) on conflict do nothing",
            eid,
            p.nurseId()
          );
        }
        if (item instanceof Device d) jdbc.update(
          "insert into device_assignments values(?,?) on conflict(device_id) do nothing",
          d.id,
          encounterIds.computeIfAbsent(d.patientId, this::encounter)
        );
        if (item instanceof Movement m) {
          saveLinks("movement_sample_links", m.id, m.sampleIds);
          saveLinks("movement_reason_codes", m.id, m.reviewReasonCodes);
          if (m.reviewedAt != null && before != null) jdbc.update(
            "insert into movement_reviews(movement_id,status,reviewer_id,reviewed_at) values(?,?,?,?)",
            m.id,
            m.verificationStatus,
            m.reviewerId,
            Timestamp.from(Instant.parse(m.reviewedAt))
          );
        }
        if (item instanceof Chart c) {
          saveLinks("chart_evidence_links", c.id, c.linkedVitalIds);
          if (
            "TASK_COMPLETION".equals(c.type) &&
            c.linkedMovementId != null &&
            before == null
          ) jdbc.update(
            "insert into movement_consumptions values(?,?)",
            c.linkedMovementId,
            c.linkedTaskId
          );
        }
        if (item instanceof Task t) {
          String previous = null;
          if (before != null) {
            try {
              previous = json.readTree(before).path("status").asText();
            } catch (Exception e) {
              throw new IllegalStateException(e);
            }
          }
          if (!Objects.equals(previous, t.status)) jdbc.update(
            "insert into task_transitions(task_id,previous_status,status,changed_at) values(?,?,?,?)",
            t.id,
            previous,
            t.status,
            Timestamp.from(s.serverTime == null ? Instant.now() : s.serverTime)
          );
        }
        s.persisted.put(key, sig);
      }
    return s;
  }

  @Transactional
  public void replace(State s) {
    jdbc.execute("select pg_advisory_xact_lock(41231001)");
    lockAll();
    jdbc.execute("select set_config('achillea.allow_reset','true',true)");
    List<Map<String, Object>> bindings = jdbc.queryForList(
      "select source_id,encounter_id,enabled from simulation_sources"
    );
    jdbc.execute(
      "truncate raw_imu_samples,ingestion_receipts,simulation_streams,simulation_sources,movement_consumptions,movement_reviews,task_transitions,chart_evidence_links,movement_sample_links,movement_reason_codes,device_assignments,care_assignments,activity_events,chart_entries,care_tasks,movement_candidates,orientation_samples,vital_observations,devices,encounters,patients,demo_metadata restart identity cascade"
    );
    s.persisted.clear();
    save(s);
    for (Map<String, Object> binding : bindings)
      jdbc.update(
        "insert into simulation_sources(source_id,encounter_id,enabled) select ?,?,? where exists(select 1 from encounters where id=?)",
        binding.get("source_id"),
        binding.get("encounter_id"),
        binding.get("enabled"),
        binding.get("encounter_id")
      );
  }
}
