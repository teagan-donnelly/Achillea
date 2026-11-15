package care.achillea;

import static care.achillea.Model.*;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Nurse-authored shift handoffs. Every create and edit appends a {@link HandoffVersion}; status
 * only moves forward through explicit commands (DRAFT -> READY -> REVIEWED -> ACKNOWLEDGED).
 * Reading a handoff never changes it. Nothing here is seeded.
 */
@Service
public class HandoffService {

  static final String NURSE = "nurse-demo";
  static final int SECTION_MAX = 5000;
  static final List<String> STATUSES = List.of("DRAFT", "READY", "REVIEWED", "ACKNOWLEDGED");

  public record CreateRequest(
    String patientId,
    HandoffSections sections,
    String shiftLabel,
    String shiftDate,
    String receiverId
  ) {}

  public record UpdateRequest(HandoffSections sections, String receiverId) {}

  public record AcknowledgeRequest(Boolean verified) {}

  private final CareService care;

  public HandoffService(CareService care) {
    this.care = care;
  }

  /** Day = 07:00-19:00, Night = 19:00-07:00 (server local time); night belongs to its start date. */
  static String[] shiftOf(Instant at, ZoneId zone) {
    LocalDateTime t = LocalDateTime.ofInstant(at, zone);
    int h = t.getHour();
    if (h >= 7 && h < 19) return new String[] { t.toLocalDate().toString(), "Day" };
    LocalDate start = h < 7 ? t.toLocalDate().minusDays(1) : t.toLocalDate();
    return new String[] { start.toString(), "Night" };
  }

  // ---------------------------------------------------------------- reads

  public List<Map<String, Object>> list(String patientId, String status, String unit) {
    if (status != null && !status.isBlank()) CareService.input(
      STATUSES.contains(status),
      "status must be one of " + String.join(", ", STATUSES)
    );
    if (unit != null && !unit.isBlank()) CareService.validateUnit(unit);
    State s = care.read();
    if (patientId != null && !patientId.isBlank()) care.patient(s, patientId);
    return s.handoffs
      .stream()
      .filter(h -> patientId == null || patientId.isBlank() || patientId.equals(h.patientId))
      .filter(h -> status == null || status.isBlank() || status.equals(h.status))
      .map(h -> view(h, care.patient(s, h.patientId)))
      .filter(v -> unit == null || unit.isBlank() || unit.equals(v.get("unit")))
      .sorted(
        Comparator.comparing((Map<String, Object> v) -> (Instant) v.get("updatedAt"))
          .reversed()
          .thenComparing(v -> (String) v.get("id"))
      )
      .toList();
  }

  public Map<String, Object> detail(String id) {
    State s = care.read();
    Handoff h = find(s, id);
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("handoff", view(h, care.patient(s, h.patientId)));
    out.put(
      "versions",
      s.handoffVersions
        .stream()
        .filter(v -> v.handoffId.equals(id))
        .sorted(Comparator.comparingInt((HandoffVersion v) -> v.version).reversed())
        .toList()
    );
    return out;
  }

  // ---------------------------------------------------------------- commands

  public Map<String, Object> create(CreateRequest r) {
    CareService.input(r != null && r.patientId() != null && !r.patientId().isBlank(), "patientId is required");
    validSections(r.sections());
    validReceiver(r.receiverId());
    return care.mutate(s -> {
      care.patient(s, r.patientId());
      Instant now = care.now();
      String[] shift = shiftOf(now, ZoneId.systemDefault());
      String label = blank(r.shiftLabel()) ? shift[1] : r.shiftLabel();
      String date = blank(r.shiftDate()) ? shift[0] : r.shiftDate();
      CareService.input(Set.of("Day", "Night").contains(label), "shiftLabel must be Day or Night");
      try {
        date = LocalDate.parse(date).toString();
      } catch (DateTimeParseException e) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "shiftDate must be YYYY-MM-DD");
      }
      String d = date;
      Optional<Handoff> open = s.handoffs
        .stream()
        .filter(
          h ->
            h.patientId.equals(r.patientId()) &&
            h.shiftDate.equals(d) &&
            h.shiftLabel.equals(label) &&
            !"ACKNOWLEDGED".equals(h.status)
        )
        .findFirst();
      CareService.require(
        open.isEmpty(),
        "An unacknowledged handoff already exists for this patient and shift (" +
          label + " " + d + ", " + open.map(h -> h.id + ", " + h.status).orElse("") +
          "); edit or complete it instead of starting another"
      );
      Handoff h = new Handoff();
      h.id = UUID.randomUUID().toString();
      h.patientId = r.patientId();
      h.shiftDate = d;
      h.shiftLabel = label;
      h.senderId = NURSE;
      h.receiverId = blank(r.receiverId()) ? null : r.receiverId().trim();
      h.status = "DRAFT";
      h.version = 1;
      h.setSections(r.sections());
      h.createdAt = h.updatedAt = now;
      s.handoffs.add(h);
      appendVersion(s, h, now);
      care.event(s, h.patientId, "handoff.created", NURSE, "Handoff draft started · " + label + " " + d);
      return view(h, care.patient(s, h.patientId));
    });
  }

  public Map<String, Object> update(String id, UpdateRequest r) {
    CareService.input(r != null, "Request body is required");
    validSections(r.sections());
    validReceiver(r.receiverId());
    return care.mutate(s -> {
      Handoff h = find(s, id);
      CareService.require(
        "DRAFT".equals(h.status),
        "Handoff is " + h.status + "; only DRAFT handoffs can be edited"
      );
      Instant now = care.now();
      h.setSections(r.sections());
      if (r.receiverId() != null) h.receiverId = r.receiverId().isBlank() ? null : r.receiverId().trim();
      h.version++;
      h.updatedAt = now;
      appendVersion(s, h, now);
      care.event(s, h.patientId, "handoff.updated", NURSE, "Handoff draft saved · version " + h.version);
      return view(h, care.patient(s, h.patientId));
    });
  }

  public Map<String, Object> transition(String id, String action, AcknowledgeRequest body) {
    if ("acknowledge".equals(action)) CareService.input(
      body != null && Boolean.TRUE.equals(body.verified()),
      "Acknowledgment requires verified: true"
    );
    return care.mutate(s -> {
      Handoff h = find(s, id);
      Instant now = care.now();
      switch (action) {
        case "ready" -> {
          expect(h, "DRAFT", "marked ready");
          h.status = "READY";
          h.readyAt = now;
        }
        case "review" -> {
          expect(h, "READY", "reviewed");
          h.status = "REVIEWED";
          h.reviewedAt = now;
          h.reviewedBy = NURSE;
        }
        case "acknowledge" -> {
          expect(h, "REVIEWED", "acknowledged");
          h.status = "ACKNOWLEDGED";
          h.acknowledgedAt = now;
          h.acknowledgedBy = NURSE;
        }
        default -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown handoff action");
      }
      h.updatedAt = now;
      care.event(
        s,
        h.patientId,
        "handoff." + switch (action) { case "review" -> "reviewed"; case "acknowledge" -> "acknowledged"; default -> "ready"; },
        NURSE,
        "Handoff " + h.status.toLowerCase(Locale.ROOT) + " · " + h.shiftLabel + " " + h.shiftDate + " · version " + h.version
      );
      return view(h, care.patient(s, h.patientId));
    });
  }

  // ---------------------------------------------------------------- helpers

  private static void expect(Handoff h, String required, String verb) {
    CareService.require(
      required.equals(h.status),
      "Handoff is " + h.status + "; only a " + required + " handoff can be " + verb
    );
  }

  private Handoff find(State s, String id) {
    Handoff h = s.handoffs
      .stream()
      .filter(x -> x.id.equals(id))
      .findFirst()
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Handoff not found"));
    care.patient(s, h.patientId); // 404 unless assigned to the demo nurse
    return h;
  }

  private static void appendVersion(State s, Handoff h, Instant now) {
    HandoffVersion v = new HandoffVersion();
    v.id = UUID.randomUUID().toString();
    v.handoffId = h.id;
    v.patientId = h.patientId;
    v.version = h.version;
    v.status = h.status;
    v.savedAt = now;
    v.savedBy = NURSE;
    v.setSections(h.getSections());
    s.handoffVersions.add(v);
  }

  private static void validSections(HandoffSections x) {
    if (x == null) return;
    for (String text : List.of(
      Objects.toString(x.currentConcerns(), ""),
      Objects.toString(x.changesDuringShift(), ""),
      Objects.toString(x.interventionsAndResponse(), ""),
      Objects.toString(x.outstandingFollowUp(), ""),
      Objects.toString(x.nextShiftPriorities(), ""),
      Objects.toString(x.additionalObservations(), "")
    )) CareService.input(
      text.length() <= SECTION_MAX,
      "Each handoff section is limited to " + SECTION_MAX + " characters"
    );
  }

  private static void validReceiver(String receiverId) {
    CareService.input(receiverId == null || receiverId.length() <= 160, "receiverId is too long");
  }

  private static boolean blank(String v) {
    return v == null || v.isBlank();
  }

  static Map<String, Object> view(Handoff h, Patient p) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("id", h.id);
    m.put("patientId", h.patientId);
    m.put("patientName", p.name());
    m.put("room", p.room());
    m.put("unit", p.unit());
    m.put("shiftDate", h.shiftDate);
    m.put("shiftLabel", h.shiftLabel);
    m.put("senderId", h.senderId);
    m.put("receiverId", h.receiverId);
    m.put("status", h.status);
    m.put("sections", h.getSections());
    m.put("version", h.version);
    m.put("createdAt", h.createdAt);
    m.put("updatedAt", h.updatedAt);
    m.put("readyAt", h.readyAt);
    m.put("reviewedAt", h.reviewedAt);
    m.put("reviewedBy", h.reviewedBy);
    m.put("acknowledgedAt", h.acknowledgedAt);
    m.put("acknowledgedBy", h.acknowledgedBy);
    return m;
  }
}
