package care.achillea;

import static care.achillea.Model.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Educational complementary-roll heuristic. Raw evidence is never silently dropped. */
@Service
public class SimulationService {

  public record Axes(
    Double ax,
    Double ay,
    Double az,
    Double gx,
    Double gy,
    Double gz
  ) {}

  public record Packet(
    String eventId,
    Instant timestamp,
    Double t,
    Axes chest,
    Axes pelvis,
    Boolean chestConnected,
    Boolean pelvisConnected
  ) {}

  public record Batch(
    Integer schemaVersion,
    String encounterId,
    String sourceId,
    String runId,
    Double timeScale,
    List<Packet> samples
  ) {}

  public record Result(
    String eventId,
    String receiptId,
    String status,
    String movementId,
    List<String> orientationIds
  ) {}

  public record Ack(
    int schemaVersion,
    String encounterId,
    String patientId,
    String sourceId,
    String runId,
    int accepted,
    int duplicates,
    List<Result> results
  ) {}

  final JdbcTemplate jdbc;
  final RelationalStore store;
  final ObjectMapper json;
  final Clock clock;

  public SimulationService(
    JdbcTemplate jdbc,
    RelationalStore store,
    ObjectMapper json,
    Clock clock
  ) {
    this.jdbc = jdbc;
    this.store = store;
    this.json = json;
    this.clock = clock;
  }

  private static void bad(boolean ok, String message) {
    if (!ok) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
  }

  private static String stable(String value) {
    return UUID.nameUUIDFromBytes(
      value.getBytes(StandardCharsets.UTF_8)
    ).toString();
  }

  private static String identifier(String s) {
    bad(
      s != null && s.matches("[A-Za-z0-9_.:-]{1,120}"),
      "Identifiers must contain 1-120 letters, digits, dot, underscore, colon or dash"
    );
    return s;
  }

  private String fingerprint(Object value) {
    try {
      return HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(
          json.writeValueAsBytes(value)
        )
      );
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static Instant observed(Packet p) {
    bad(
      (p.timestamp() != null) != (p.t() != null),
      "Supply exactly one timestamp (ISO UTC) or t (Unix seconds)"
    );
    if (p.timestamp() != null) return p.timestamp();
    bad(
      Double.isFinite(p.t()) && p.t() > 0 && p.t() < 32503680000d,
      "Invalid epoch timestamp"
    );
    long seconds = (long) Math.floor(p.t());
    return Instant.ofEpochSecond(
      seconds,
      Math.round((p.t() - seconds) * 1_000_000_000)
    );
  }

  private static void axes(Axes a) {
    if (a == null) return;
    for (Double v : List.of(
      a.ax() == null ? Double.NaN : a.ax(),
      a.ay() == null ? Double.NaN : a.ay(),
      a.az() == null ? Double.NaN : a.az(),
      a.gx() == null ? Double.NaN : a.gx(),
      a.gy() == null ? Double.NaN : a.gy(),
      a.gz() == null ? Double.NaN : a.gz()
    ))
      bad(Double.isFinite(v), "All six IMU axes must be finite numbers");
    bad(
      Math.abs(a.ax()) <= 32 &&
        Math.abs(a.ay()) <= 32 &&
        Math.abs(a.az()) <= 32 &&
        Math.abs(a.gx()) <= 4000 &&
        Math.abs(a.gy()) <= 4000 &&
        Math.abs(a.gz()) <= 4000,
      "IMU exceeds contract bounds (g, degrees/second)"
    );
  }

  String patient(String encounter) {
    List<String> p = jdbc.queryForList(
      "select e.patient_id from encounters e join patients p on p.id=e.patient_id join care_assignments a on a.encounter_id=e.id where e.id=? and e.active and e.synthetic and a.nurse_id='nurse-demo' and p.nurse_id='nurse-demo'",
      String.class,
      encounter
    );
    if (p.isEmpty()) throw new ResponseStatusException(
      HttpStatus.NOT_FOUND,
      "Assigned active synthetic encounter not found"
    );
    return p.getFirst();
  }

  void authorizedSource(String source, String encounter) {
    if (
      jdbc.queryForObject(
        "select count(*) from simulation_sources where source_id=? and encounter_id=? and enabled",
        Integer.class,
        source,
        encounter
      ) != 1
    ) throw new ResponseStatusException(
      HttpStatus.FORBIDDEN,
      "Source is not assigned to this encounter"
    );
  }

  @Transactional
  public void bind(String source, String encounter) {
    identifier(source);
    patient(encounter);
    jdbc.update(
      "insert into simulation_sources(source_id,encounter_id) values(?,?) on conflict do nothing",
      source,
      encounter
    );
  }

  private static Instant instant(Map<String, Object> m, String key) {
    Object v = m.get(key);
    return v == null
      ? null
      : v instanceof java.sql.Timestamp t
        ? t.toInstant()
        : ((java.time.OffsetDateTime) v).toInstant();
  }

  private static Double number(Map<String, Object> m, String key) {
    Object v = m.get(key);
    return v == null ? null : ((Number) v).doubleValue();
  }

  private Device device(
    String encounter,
    String source,
    String pid,
    String region
  ) {
    String id = "external-" + stable(source + "/" + encounter + "/" + region);
    List<Device> rows = jdbc.query(
      "select id from devices where id=?",
      (rs, n) -> new Device(rs.getString(1), pid, region, null),
      id
    );
    Device d = new Device(id, pid, region, null);
    d.manualOverride = true;
    d.timeDomain = "SIMULATION";
    if (rows.isEmpty()) {
      State state = new State();
      state.devices.add(d);
      store.save(state);
    }
    return d;
  }

  private static double roll(
    Axes a,
    Double previous,
    Instant previousTime,
    Instant time
  ) {
    double acceleration = Math.toDegrees(Math.atan2(a.ay(), a.az()));
    if (previous == null || previousTime == null) return acceleration;
    double dt = (time.toEpochMilli() - previousTime.toEpochMilli()) / 1000d;
    if (dt <= 0 || dt > 1) return acceleration;
    double prediction = previous + a.gx() * dt;
    return (
      prediction + 0.02 * Math.IEEEremainder(acceleration - prediction, 360)
    );
  }

  @Transactional
  public Ack ingest(Batch batch, int maxBatch) {
    bad(
      batch != null && Objects.equals(batch.schemaVersion(), 1),
      "schemaVersion must be 1"
    );
    identifier(batch.encounterId());
    identifier(batch.sourceId());
    identifier(batch.runId());
    bad(
      batch.timeScale() != null &&
        Double.isFinite(batch.timeScale()) &&
        batch.timeScale() >= 1 &&
        batch.timeScale() <= 600,
      "timeScale must be 1..600"
    );
    bad(
      batch.samples() != null &&
        !batch.samples().isEmpty() &&
        batch.samples().size() <= maxBatch,
      "Batch must contain 1.." + maxBatch + " packets"
    );
    // Validate every packet before any write. One malformed packet rolls back the whole batch.
    for (Packet p : batch.samples()) {
      bad(p != null, "Null packet");
      identifier(p.eventId());
      observed(p);
      axes(p.chest());
      axes(p.pelvis());
      bad(
        p.chest() != null ||
          p.pelvis() != null ||
          Boolean.FALSE.equals(p.chestConnected()) ||
          Boolean.FALSE.equals(p.pelvisConnected()),
        "At least one region or explicit disconnection is required"
      );
    }
    jdbc.execute("set local lock_timeout='2s'");
    jdbc.execute("set local statement_timeout='15s'");
    String pid = patient(batch.encounterId());
    authorizedSource(batch.sourceId(), batch.encounterId());
    store.lockPatient(pid);
    jdbc.update(
      "insert into simulation_streams(source_id,encounter_id,run_id,time_scale) values(?,?,?,?) on conflict do nothing",
      batch.sourceId(),
      batch.encounterId(),
      batch.runId(),
      batch.timeScale()
    );
    Map<String, Object> stream = jdbc.queryForMap(
      "select * from simulation_streams where source_id=? and encounter_id=? and run_id=? for update",
      batch.sourceId(),
      batch.encounterId(),
      batch.runId()
    );
    if (
      Double.compare(number(stream, "time_scale"), batch.timeScale()) != 0
    ) throw new ResponseStatusException(
      HttpStatus.CONFLICT,
      "timeScale cannot change within a run; use a new runId"
    );
    Device chest = device(
        batch.encounterId(),
        batch.sourceId(),
        pid,
        "UPPER_TORSO"
      ),
      pelvis = device(batch.encounterId(), batch.sourceId(), pid, "PELVIS");
    State metadata = store.load(pid, null, false, null,Set.of("patients","devices","care_tasks"));
    chest = metadata.devices
      .stream()
      .filter(d ->
        d.id.equals(
          "external-" +
            stable(
              batch.sourceId() + "/" + batch.encounterId() + "/UPPER_TORSO"
            )
        )
      )
      .findFirst()
      .orElseThrow();
    pelvis = metadata.devices
      .stream()
      .filter(d ->
        d.id.equals(
          "external-" +
            stable(batch.sourceId() + "/" + batch.encounterId() + "/PELVIS")
        )
      )
      .findFirst()
      .orElseThrow();
    State pending=new State();pending.patients.addAll(metadata.patients);pending.persisted.putAll(metadata.persisted);
    List<Object[]> receiptRows=new ArrayList<>(),rawRows=new ArrayList<>();
    Map<String,Map<String,Object>> previousReceipts=new HashMap<>();
    List<String> incoming=batch.samples().stream().map(p->stable(batch.encounterId()+"/"+batch.sourceId()+"/"+batch.runId()+"/"+p.eventId())).distinct().toList();
    for(Map<String,Object> row:jdbc.queryForList("select id,content_hash,movement_id from ingestion_receipts where id in ("+String.join(",",Collections.nCopies(incoming.size(),"?"))+")",incoming.toArray()))previousReceipts.put((String)row.get("id"),row);
    List<Result> results = new ArrayList<>();
    int duplicates = 0;
    for (Packet packet : batch.samples()) {
      Instant sampleTime = observed(packet),
        received = clock.instant();
      String receipt = stable(
          batch.encounterId() +
            "/" +
            batch.sourceId() +
            "/" +
            batch.runId() +
            "/" +
            packet.eventId()
        ),
        hash = fingerprint(packet);
      Map<String,Object> old=previousReceipts.get(receipt);
      if(old!=null){if(!hash.equals(old.get("content_hash")))throw new ResponseStatusException(HttpStatus.CONFLICT,"eventId reused with different content");duplicates++;List<String> ids=new ArrayList<>();if(packet.chest()!=null)ids.add("orientation-"+stable(receipt+"/UPPER_TORSO"));if(packet.pelvis()!=null)ids.add("orientation-"+stable(receipt+"/PELVIS"));results.add(new Result(packet.eventId(),receipt,"DUPLICATE",(String)old.get("movement_id"),ids));continue;}
      Instant previous = instant(stream, "last_observed_at");
      boolean late = previous != null && sampleTime.isBefore(previous);
      String status = late
        ? "OUT_OF_ORDER"
        : previous != null && sampleTime.equals(previous)
          ? "TIMESTAMP_TIE"
          : "PROCESSED";
      State changes = new State();
      changes.serverTime = received;
      changes.patients.addAll(metadata.patients);
      changes.tasks.addAll(metadata.tasks);
      changes.persisted.putAll(metadata.persisted);
      List<String> samples = new ArrayList<>();
      Double chestBefore = number(stream, "chest_roll"),
        pelvisBefore = number(stream, "pelvis_roll");
      for (String region : List.of("UPPER_TORSO", "PELVIS")) {
        boolean torso = region.equals("UPPER_TORSO");
        Axes a = torso ? packet.chest() : packet.pelvis();
        Device d = torso ? chest : pelvis;
        Boolean connected = torso
          ? packet.chestConnected()
          : packet.pelvisConnected();
        String field = torso ? "chest" : "pelvis";
        if (!late) {
          String previousConnection = d.connectionState;
          d.simulationScale = batch.timeScale();
          d.lastSourceAt = sampleTime;
          d.lastSeenAt = received;
          d.lastSampledAt = sampleTime;
          d.connectionState = Boolean.FALSE.equals(connected)
            ? "DISCONNECTED"
            : a == null
              ? "UNKNOWN"
              : "CONNECTED";
          d.freshness = a == null ? "UNKNOWN" : "FRESH";
          changes.devices.add(d);
          if (
            !Objects.equals(previousConnection, d.connectionState)
          ) changes.events.add(
            new Event(
              "device-event-" + receipt + "-" + region,
              pid,
              "device." + d.connectionState.toLowerCase(Locale.ROOT),
              "EXTERNAL_SIMULATION",
              d.id + " / " + d.connectionState,
              received
            )
          );
        }
        if (a == null) continue;
        String rawId = stable(receipt + "/" + region),
          orientationId = "orientation-" + rawId;
        Double before = number(stream, field + "_roll");
        Instant beforeTime = instant(stream, field + "_time");
        double norm = Math.sqrt(
          a.ax() * a.ax() + a.ay() * a.ay() + a.az() * a.az()
        );
        String quality = late
          ? "OUT_OF_ORDER"
          : !Boolean.FALSE.equals(connected) && norm >= 0.5 && norm <= 1.5
            ? "SIMULATED_GOOD"
            : "UNCERTAIN_ACCELERATION";
        boolean usable = quality.equals("SIMULATED_GOOD");
        double angle = roll(a, before, beforeTime, sampleTime);
        rawRows.add(new Object[]{
          rawId,
          receipt,
          batch.encounterId(),
          d.id,
          region,
          a.ax(),
          a.ay(),
          a.az(),
          a.gx(),
          a.gy(),
          a.gz(),
          java.sql.Timestamp.from(sampleTime),
          java.sql.Timestamp.from(received),
          java.sql.Timestamp.from(clock.instant()),
          quality,
          packet.timestamp() != null
            ? packet.timestamp().toString()
            : packet.t().toString(),
          orientationId
        });
        // Captured time is the source simulation instant; freshness uses the separate transport clock.
        changes.samples.add(
          new OrientationSample(
            orientationId,
            d.id,
            pid,
            region,
            angle,
            sampleTime,
            received,
            quality,
            "EXTERNAL_SIMULATION"
          )
        );
        samples.add(orientationId);
        if (!late && usable) {
          stream.put(field + "_roll", angle);
          stream.put(field + "_time", java.sql.Timestamp.from(sampleTime));
          if (number(stream, field + "_anchor") == null) stream.put(
            field + "_anchor",
            angle
          );
        }
      }
      String movementId = null;
      if (!late) {
        Double c = number(stream, "chest_roll"),
          p = number(stream, "pelvis_roll"),
          ca = number(stream, "chest_anchor"),
          pa = number(stream, "pelvis_anchor");
        Instant lastCandidate = instant(stream, "last_candidate_at");
        boolean uncertain = changes.samples
          .stream()
          .anyMatch(x -> !x.quality().equals("SIMULATED_GOOD"));
        boolean gap =
          packet.chest() == null ||
          packet.pelvis() == null ||
          Boolean.FALSE.equals(packet.chestConnected()) ||
          Boolean.FALSE.equals(packet.pelvisConnected());
        double dc =
            c == null || ca == null
              ? 0
              : Math.abs(Math.IEEEremainder(c - ca, 360)),
          dp =
            p == null || pa == null
              ? 0
              : Math.abs(Math.IEEEremainder(p - pa, 360));
        if (
          chestBefore != null &&
          pelvisBefore != null &&
          c != null &&
          p != null &&
          (dc >= 5 || dp >= 5) &&
          (lastCandidate == null ||
            !sampleTime.isBefore(lastCandidate.plusSeconds(2)))
        ) {
          Movement m = new Movement();
          m.id = "movement-" + receipt;
          m.patientId = pid;
          m.classification =
            gap || uncertain
              ? "UNKNOWN"
              : dc >= 30 && dp >= 30
                ? "COORDINATED_TURN_CANDIDATE"
                : dc >= 30
                  ? "PARTIAL_TORSO_MOVEMENT"
                  : dp >= 30 ? "PARTIAL_PELVIC_MOVEMENT" : "SMALL_ADJUSTMENT";
          m.quality = gap
            ? "INCOMPLETE_REGION_DATA"
            : uncertain
              ? "UNCERTAIN_ACCELERATION"
              : "SIMULATED_GOOD";
          m.chestBefore = chestBefore == null ? 0 : chestBefore;
          m.pelvisBefore = pelvisBefore == null ? 0 : pelvisBefore;
          m.chestAfter = c == null ? 0 : c;
          m.pelvisAfter = p == null ? 0 : p;
          m.chestSensorId = chest.id;
          m.pelvisSensorId = pelvis.id;
          m.capturedAt = sampleTime;
          m.receivedAt = received;
          m.sampleIds = samples;
          WorkflowRules.classify(m);
          changes.movements.add(m);
          changes.events.add(
            new Event(
              "event-" + receipt,
              pid,
              "movement.candidate",
              "EXTERNAL_SIMULATION",
              m.classification +
                " / source=" +
                batch.sourceId() +
                " / run=" +
                batch.runId() +
                (m.reviewRequired?" / nurse review required":" / recorded adjustment; no automatic care"),
              received
            )
          );
          WorkflowRules.apply(changes, received);
          movementId = m.id;
          if(dc>=30||dp>=30){stream.put("chest_anchor", c);stream.put("pelvis_anchor", p);}
          stream.put("last_candidate_at", java.sql.Timestamp.from(sampleTime));
        }
        stream.put("last_observed_at", java.sql.Timestamp.from(sampleTime));
        stream.put("last_received_at", java.sql.Timestamp.from(received));
      }
      if (!late) WorkflowRules.apply(changes, received);
      pending.serverTime=received;pending.samples.addAll(changes.samples);pending.movements.addAll(changes.movements);pending.events.addAll(changes.events);pending.tasks=changes.tasks;metadata.tasks=changes.tasks;
      receiptRows.add(new Object[]{receipt,batch.sourceId(),batch.encounterId(),batch.runId(),packet.eventId(),hash,java.sql.Timestamp.from(sampleTime),java.sql.Timestamp.from(received),java.sql.Timestamp.from(clock.instant()),status,movementId});
      Map<String,Object> cached=new HashMap<>();cached.put("content_hash",hash);cached.put("movement_id",movementId);previousReceipts.put(receipt,cached);
      results.add(
        new Result(packet.eventId(), receipt, status, movementId, samples)
      );
    }
    if(!receiptRows.isEmpty()){
      jdbc.batchUpdate("insert into ingestion_receipts(id,source_id,encounter_id,run_id,event_id,content_hash,observed_at,received_at,processed_at,processing_status,movement_id) values(?,?,?,?,?,?,?,?,?,?,?)",receiptRows);
      jdbc.batchUpdate("insert into raw_imu_samples values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",rawRows);
      List<Object[]> orientations=pending.samples.stream().map(o->new Object[]{o.id(),o.sensorId(),o.patientId(),o.bodyRegion(),o.rollDegrees(),java.sql.Timestamp.from(o.capturedAt()),java.sql.Timestamp.from(o.receivedAt()),o.quality(),o.mode(),batch.encounterId()}).toList();
      jdbc.batchUpdate("insert into orientation_samples(id,sensor_id,patient_id,body_region,roll_degrees,captured_at,received_at,quality,mode,encounter_id) values(?,?,?,?,?,?,?,?,?,?)",orientations);
      pending.samples.clear();pending.devices.add(chest);pending.devices.add(pelvis);store.save(pending);
    }
    jdbc.update(
      "update simulation_streams set last_observed_at=?,last_received_at=?,chest_roll=?,pelvis_roll=?,chest_anchor=?,pelvis_anchor=?,chest_time=?,pelvis_time=?,last_candidate_at=? where source_id=? and encounter_id=? and run_id=?",
      stream.get("last_observed_at"),
      stream.get("last_received_at"),
      stream.get("chest_roll"),
      stream.get("pelvis_roll"),
      stream.get("chest_anchor"),
      stream.get("pelvis_anchor"),
      stream.get("chest_time"),
      stream.get("pelvis_time"),
      stream.get("last_candidate_at"),
      batch.sourceId(),
      batch.encounterId(),
      batch.runId()
    );
    return new Ack(
      1,
      batch.encounterId(),
      pid,
      batch.sourceId(),
      batch.runId(),
      results.size() - duplicates,
      duplicates,
      results
    );
  }

  @Transactional(readOnly = true)
  public Map<String, Object> history(
    String encounter,
    String source,
    long after,
    int limit
  ) {
    String pid = patient(encounter);
    authorizedSource(source, encounter);
    bad(
      after >= 0 && limit >= 1 && limit <= 500,
      "after>=0 and limit=1..500 required"
    );
    List<Map<String, Object>> rows = jdbc.queryForList(
      "select r.sequence,r.id,r.run_id,r.event_id,r.observed_at,r.received_at,r.processed_at,r.processing_status,r.movement_id from ingestion_receipts r where r.encounter_id=? and r.source_id=? and r.sequence>? order by r.sequence limit ?",
      encounter,
      source,
      after,
      limit
    );
    for (Map<String, Object> row : rows) {
      row.put(
        "orientations",
        jdbc.queryForList(
          "select o.id,o.sensor_id,o.body_region,o.roll_degrees,o.captured_at,o.received_at,o.quality,r.ax,r.ay,r.az,r.gx,r.gy,r.gz,r.source_time from raw_imu_samples r join orientation_samples o on o.id=r.derived_sample_id where r.receipt_id=? order by o.body_region",
          row.get("id")
        )
      );
      if (row.get("movement_id") != null) row.put(
        "movement",
        jdbc.queryForMap(
          "select id,classification,quality,verification_status,review_required,captured_at,received_at from movement_candidates where id=?",
          row.get("movement_id")
        )
      );
    }
    long next = rows.isEmpty()
      ? after
      : ((Number) rows.getLast().get("sequence")).longValue();
    return Map.of(
      "encounterId",
      encounter,
      "patientId",
      pid,
      "sourceId",
      source,
      "items",
      rows,
      "nextAfter",
      next,
      "hasMore",
      rows.size() == limit,
      "timeDomain",
      "SIMULATION",
      "filterVersion",
      "COMPLEMENTARY_ROLL_V1"
    );
  }
}
