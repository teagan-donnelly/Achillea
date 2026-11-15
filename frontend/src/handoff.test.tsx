import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  HandoffApiError,
  HandoffUnavailableError,
  acknowledgeHandoff,
  createHandoff,
  getHandoff,
  listHandoffs,
  saveHandoffDraft,
} from "./handoff-api";
import {
  bucketHandoffs,
  historyGroups,
  openTasks,
  previousHandoffs,
  shiftOf,
  shiftTimeline,
  shiftWindow,
  startCandidates,
} from "./handoff-model";
import type {
  Handoff as HandoffRecord,
  HandoffSections,
} from "./handoff-types";
import { Handoff } from "./Handoff";
import type { ScreenProps } from "./app-context";
import type { Patient, State, Task } from "./types";

const sections = (currentConcerns = ""): HandoffSections => ({
  currentConcerns,
  changesDuringShift: "",
  interventionsAndResponse: "",
  outstandingFollowUp: "",
  nextShiftPriorities: "",
  additionalObservations: "",
});
function handoff(
  id: string,
  patientId: string,
  status: HandoffRecord["status"],
  extra: Partial<HandoffRecord> = {},
): HandoffRecord {
  return {
    id,
    patientId,
    shiftDate: "2026-11-14",
    shiftLabel: "Night",
    senderId: "nurse-demo",
    receiverId: null,
    status,
    sections: sections("Watch sacral skin"),
    version: 1,
    createdAt: "2026-11-15T01:00:00Z",
    updatedAt: "2026-11-15T02:00:00Z",
    readyAt: null,
    reviewedAt: null,
    reviewedBy: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    patientName: "Alex Linden",
    room: "108",
    unit: "ICU",
    ...extra,
  };
}
const patient: Patient = {
  id: "p1",
  name: "Alex Linden",
  room: "108",
  unit: "ICU",
  summary: "Synthetic",
  nurseId: "nurse-demo",
  repositionPlan: false,
};
function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    patientId: "p1",
    title: `Task ${id}`,
    type: "ASSESSMENT",
    status: "OPEN",
    priority: "ROUTINE",
    source: "SCHEDULE",
    dueAt: "2026-11-15T04:00:00Z",
    verificationRequired: false,
    deferReason: null,
    order: 0,
    completedAt: null,
    verifiedBy: null,
    ...extra,
  };
}
const emptyState: State = {
  patients: [patient],
  tasks: [],
  vitals: [],
  movements: [],
  charts: [],
  events: [],
  devices: [],
};

function mockFetch(
  handler: (
    url: string,
    init?: RequestInit,
  ) => { status?: number; body: unknown },
) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const { status = 200, body } = handler(url, init);
    return { ok: status < 400, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handoff-api", () => {
  it("lists handoffs with query parameters", async () => {
    const fetch = mockFetch(() => ({ body: [handoff("h1", "p1", "DRAFT")] }));
    const list = await listHandoffs({ unit: "ICU", status: "DRAFT" });
    expect(list.map((h) => h.id)).toEqual(["h1"]);
    expect(fetch.mock.calls[0]![0]).toBe("/api/handoffs?unit=ICU&status=DRAFT");
  });

  it("treats a 404 or a non-list response as a backend without the handoff API", async () => {
    mockFetch(() => ({ status: 404, body: { message: "Not Found" } }));
    await expect(listHandoffs()).rejects.toBeInstanceOf(
      HandoffUnavailableError,
    );
    mockFetch(() => ({ body: { patients: [] } }));
    await expect(listHandoffs()).rejects.toBeInstanceOf(
      HandoffUnavailableError,
    );
  });

  it("surfaces the backend message and status on conflicts", async () => {
    mockFetch(() => ({
      status: 409,
      body: {
        code: "CONFLICT",
        message: "An unacknowledged handoff already exists",
      },
    }));
    const error = await createHandoff({ patientId: "p1" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HandoffApiError);
    expect((error as HandoffApiError).status).toBe(409);
    expect((error as Error).message).toBe(
      "An unacknowledged handoff already exists",
    );
  });

  it("saves drafts with PATCH and acknowledges only with verified: true", async () => {
    const fetch = mockFetch(() => ({ body: handoff("h1", "p1", "DRAFT") }));
    await saveHandoffDraft("h1", { sections: { currentConcerns: "x" } });
    expect(fetch.mock.calls[0]![0]).toBe("/api/handoffs/h1");
    expect(fetch.mock.calls[0]![1]!.method).toBe("PATCH");
    await acknowledgeHandoff("h1");
    expect(fetch.mock.calls[1]![0]).toBe("/api/handoffs/h1/acknowledge");
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({
      verified: true,
    });
  });

  it("returns detail with versions", async () => {
    mockFetch(() => ({
      body: {
        handoff: handoff("h1", "p1", "READY"),
        versions: [{ id: "v1", version: 1 }],
      },
    }));
    const detail = await getHandoff("h1");
    expect(detail.handoff.status).toBe("READY");
    expect(detail.versions).toHaveLength(1);
  });
});

describe("handoff-model", () => {
  it("derives Day 07-19 and Night 19-07 shifts; a night belongs to its start date", () => {
    expect(shiftOf(new Date(2026, 10, 15, 3, 0).getTime())).toEqual({
      shiftDate: "2026-11-14",
      shiftLabel: "Night",
    });
    expect(shiftOf(new Date(2026, 10, 15, 7, 0).getTime())).toEqual({
      shiftDate: "2026-11-15",
      shiftLabel: "Day",
    });
    expect(shiftOf(new Date(2026, 10, 15, 19, 30).getTime())).toEqual({
      shiftDate: "2026-11-15",
      shiftLabel: "Night",
    });
    const w = shiftWindow("2026-11-14", "Night");
    expect(w.start).toBe(new Date(2026, 10, 14, 19).getTime());
    expect(w.end).toBe(new Date(2026, 10, 15, 7).getTime());
  });

  it("buckets incoming, outgoing and history by status", () => {
    const list = [
      handoff("d", "p1", "DRAFT"),
      handoff("r", "p2", "READY"),
      handoff("v", "p3", "REVIEWED"),
      handoff("a", "p4", "ACKNOWLEDGED"),
    ];
    const b = bucketHandoffs(list);
    expect(b.outgoing.map((h) => h.id).sort()).toEqual(["d", "r"]);
    expect(b.incoming.map((h) => h.id).sort()).toEqual(["r", "v"]);
    expect(b.history.map((h) => h.id)).toEqual(["a"]);
  });

  it("groups history by shift, newest first", () => {
    const groups = historyGroups([
      handoff("a", "p1", "ACKNOWLEDGED", {
        shiftDate: "2026-11-13",
        shiftLabel: "Night",
      }),
      handoff("b", "p1", "ACKNOWLEDGED", {
        shiftDate: "2026-11-14",
        shiftLabel: "Day",
      }),
      handoff("c", "p2", "ACKNOWLEDGED", {
        shiftDate: "2026-11-14",
        shiftLabel: "Night",
      }),
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "2026-11-14-Night",
      "2026-11-14-Day",
      "2026-11-13-Night",
    ]);
  });

  it("offers Start handoff only for patients without an open handoff this shift", () => {
    const now = new Date(2026, 10, 15, 3).getTime();
    const p2 = { ...patient, id: "p2", room: "109" };
    const list = [handoff("h", "p1", "DRAFT")];
    expect(startCandidates([patient, p2], list, now).map((p) => p.id)).toEqual([
      "p2",
    ]);
    // An acknowledged handoff does not block a new one.
    expect(
      startCandidates([patient], [handoff("h", "p1", "ACKNOWLEDGED")], now).map(
        (p) => p.id,
      ),
    ).toEqual(["p1"]);
    expect(
      previousHandoffs(
        [
          ...list,
          handoff("old", "p1", "ACKNOWLEDGED", { shiftDate: "2026-11-13" }),
        ],
        "p1",
        "h",
      ).map((h) => h.id),
    ).toEqual(["old"]);
  });

  it("lists open tasks in round order and never includes completed ones", () => {
    const state = {
      ...emptyState,
      tasks: [task("a"), task("b"), task("c", { status: "COMPLETED" })],
    };
    const rounds = [{ task: task("b"), reason: "", rank: 0 }];
    expect(openTasks(state, rounds, "p1").map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("shows only earlier shifts when reading a historical report", () => {
    const list = [
      handoff("current", "p1", "ACKNOWLEDGED", { shiftLabel: "Day" }),
      handoff("future", "p1", "DRAFT", { shiftLabel: "Night" }),
      handoff("previous", "p1", "ACKNOWLEDGED", { shiftDate: "2026-11-13" }),
    ];
    expect(previousHandoffs(list, "p1", "current").map((h) => h.id)).toEqual([
      "previous",
    ]);
  });

  it("builds a shift timeline that separates sensor events from nurse documentation", () => {
    const w = shiftWindow("2026-11-14", "Night");
    const at = (h: number) => new Date(w.start + h * 3600000).toISOString();
    const state: State = {
      ...emptyState,
      devices: [
        {
          id: "torso-1",
          patientId: "p1",
          bodyRegion: "UPPER_TORSO",
          connectionState: "CONNECTED",
          freshness: "FRESH",
          mode: "SIM",
          calibrationStatus: "",
          lastSeenAt: null,
          lastSampledAt: null,
        },
      ],
      tasks: [
        task("t1", {
          status: "COMPLETED",
          completedAt: at(3),
          verifiedBy: "nurse-demo",
        }),
      ],
      charts: [
        {
          id: "c1",
          patientId: "p1",
          nurseId: "nurse-demo",
          type: "NOTE",
          text: "Turned left",
          status: "CONFIRMED",
          linkedTaskId: null,
          linkedMovementId: null,
          linkedVitalIds: [],
          authoredAt: at(1),
          confirmedAt: at(1),
          amendmentOfId: null,
          provenance: "NURSE",
        },
        // Task completion chart rows are represented by the completed task, not twice.
        {
          id: "c2",
          patientId: "p1",
          nurseId: "nurse-demo",
          type: "TASK_COMPLETION",
          text: "Done",
          status: "CONFIRMED",
          linkedTaskId: "t1",
          linkedMovementId: null,
          linkedVitalIds: [],
          authoredAt: at(3),
          confirmedAt: at(3),
          amendmentOfId: null,
          provenance: "NURSE_VERIFIED_CARE",
        },
        {
          id: "c3",
          patientId: "p1",
          nurseId: "nurse-demo",
          type: "NOTE",
          text: "Draft",
          status: "DRAFT",
          linkedTaskId: null,
          linkedMovementId: null,
          linkedVitalIds: [],
          authoredAt: at(2),
          confirmedAt: null,
          amendmentOfId: null,
          provenance: "NURSE",
        },
      ],
      events: [
        {
          id: "e1",
          patientId: "p1",
          type: "device.disconnected",
          source: "SIMULATED_MONITOR",
          details: "torso-1 · DISCONNECTED · simulated",
          timestamp: at(2),
        },
        {
          id: "e2",
          patientId: "p1",
          type: "vital.received",
          source: "SIMULATED_MONITOR",
          details: "batch",
          timestamp: at(2),
        },
        {
          id: "e3",
          patientId: "p1",
          type: "device.disconnected",
          source: "SIMULATED_MONITOR",
          details: "torso-1",
          timestamp: at(-2),
        },
      ],
      movements: [
        {
          id: "m1",
          patientId: "p1",
          classification: "FULL_TURN",
          quality: "SIMULATED_GOOD",
          verificationStatus: "CONFIRMED_CARE",
          reviewerId: "nurse-demo",
          reviewedAt: at(4),
          chestBefore: 0,
          pelvisBefore: 0,
          chestAfter: 30,
          pelvisAfter: 30,
          capturedAt: at(4),
          sampleIds: [],
        },
      ],
    };
    const items = shiftTimeline(state, "p1", w);
    expect(items.map((i) => [i.title, i.origin])).toEqual([
      ["Chart entry confirmed · note", "nurse"],
      ["Torso sensor disconnected", "sensor"],
      ["Completed · Task t1", "nurse"],
      ["Turn verified", "verified"],
    ]);
  });
});

describe("Handoff screen", () => {
  const props = (state: State): ScreenProps => ({
    state,
    patients: state.patients,
    rounds: [],
    activity: [],
    unit: "ICU",
    label: "ICU",
    mutate: vi.fn(),
    busy: false,
    refresh: vi.fn(),
    selectUnit: vi.fn(),
  });

  it("shows a minimal retry state when the handoff API is missing and keeps patient rows", async () => {
    mockFetch(() => ({ status: 404, body: { message: "Not Found" } }));
    render(
      <MemoryRouter initialEntries={["/activity?tab=outgoing"]}>
        <Handoff {...props(emptyState)} />
      </MemoryRouter>,
    );
    expect(
      await screen.findByText("Couldn’t load handoffs"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Alex Linden, Room 108/ }),
    ).toHaveAttribute("href", "/activity?tab=outgoing&patient=p1");
  });

  it("finds a patient by room and links straight to their handoff", async () => {
    const second = { ...patient, id: "p2", name: "Robin Ash", room: "109" };
    const reports = [
      handoff("h1", "p1", "READY"),
      handoff("h2", "p2", "READY", {
        patientName: second.name,
        room: second.room,
      }),
    ];
    mockFetch(() => ({ body: reports }));
    render(
      <MemoryRouter initialEntries={["/activity?tab=incoming"]}>
        <Handoff {...props({ ...emptyState, patients: [patient, second] })} />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: /^Alex Linden, Room 108/ });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search handoff patients" }),
      { target: { value: "109" } },
    );
    expect(
      screen.queryByRole("link", { name: /^Alex Linden, Room 108/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /^Robin Ash, Room 109/ }),
    ).toHaveAttribute("href", "/activity?tab=incoming&q=109&handoff=h2");
    fireEvent.click(
      screen.getByRole("button", { name: "Clear handoff search" }),
    );
    expect(
      screen.getByRole("link", { name: /^Alex Linden, Room 108/ }),
    ).toBeInTheDocument();
  });

  it("saves notes directly from the header or keyboard without advancing status and locks inputs until saved", async () => {
    let draft = handoff("h1", "p1", "DRAFT");
    let finishSave: (() => void) | undefined;
    const response = (body: unknown) =>
      ({ ok: true, status: 200, json: async () => body }) as Response;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const payload = JSON.parse(init.body as string);
        return new Promise<Response>((resolve) => {
          finishSave = () => {
            draft = {
              ...draft,
              sections: payload.sections,
              receiverId: payload.receiverId,
              version: draft.version + 1,
            };
            resolve(response(draft));
          };
        });
      }
      return response(
        url === "/api/handoffs/h1" ? { handoff: draft, versions: [] } : [draft],
      );
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <MemoryRouter initialEntries={["/activity?tab=outgoing&handoff=h1"]}>
        <Handoff {...props(emptyState)} />
      </MemoryRouter>,
    );
    const notes = await screen.findByRole("textbox", {
      name: "Current concerns",
    });
    expect(
      screen.getByRole("button", { name: "Save handoff draft" }),
    ).toBeDisabled();
    fireEvent.change(notes, {
      target: { value: "Recheck comfort after walking" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save handoff draft" }));
    await waitFor(() => expect(finishSave).toBeDefined());
    expect(notes).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Receiving nurse" }),
    ).toBeDisabled();
    finishSave!();
    await screen.findByText("Handoff saved");
    expect(notes).toBeEnabled();
    expect(notes).toHaveValue("Recheck comfort after walking");
    fireEvent.change(notes, {
      target: { value: "Comfort reassessed; next review due" },
    });
    fireEvent.keyDown(notes, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter(([, init]) => init?.method === "PATCH"),
      ).toHaveLength(2),
    );
    finishSave!();
    await screen.findByText("Handoff saved");
    expect(draft.status).toBe("DRAFT");
    expect(draft.sections.currentConcerns).toBe(
      "Comfort reassessed; next review due",
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      false,
    );
  });

  it("never acknowledges on open; acknowledgment needs the verification checkbox", async () => {
    const reviewed = handoff("h1", "p1", "REVIEWED", {
      readyAt: "2026-11-15T02:00:00Z",
      reviewedAt: "2026-11-15T02:10:00Z",
      reviewedBy: "nurse-demo",
    });
    const fetch = mockFetch((url) => {
      if (url.startsWith("/api/handoffs/h1/acknowledge"))
        return { body: { ...reviewed, status: "ACKNOWLEDGED" } };
      if (url.startsWith("/api/handoffs/h1"))
        return { body: { handoff: reviewed, versions: [] } };
      return { body: [reviewed] };
    });
    render(
      <MemoryRouter initialEntries={["/activity?tab=incoming&handoff=h1"]}>
        <Handoff {...props(emptyState)} />
      </MemoryRouter>,
    );
    const ack = await screen.findByRole("button", { name: "Acknowledge" });
    expect(ack).toBeDisabled();
    expect(
      fetch.mock.calls.some(
        ([, init]) => init?.method && init.method !== "GET",
      ),
    ).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(ack);
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            url === "/api/handoffs/h1/acknowledge" && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("explains draft readiness and protects unsaved notes when opening another tab", async () => {
    const draft = handoff("h1", "p1", "DRAFT");
    mockFetch((url) => ({
      body: url.startsWith("/api/handoffs/h1")
        ? { handoff: draft, versions: [] }
        : [draft],
    }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <MemoryRouter initialEntries={["/activity?tab=outgoing&handoff=h1"]}>
        <Handoff {...props({ ...emptyState, tasks: [task("original")] })} />
      </MemoryRouter>,
    );
    const notes = await screen.findByRole("textbox", {
      name: "Current concerns",
    });
    fireEvent.change(notes, {
      target: { value: "Recheck discomfort after walking" },
    });
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
    expect(
      screen.getByText(/save your draft before marking it ready/),
    ).toBeInTheDocument();
    // Open care now lives in the source-linked priorities; any in-app link must still guard notes.
    const otherTab = screen.getAllByRole("link").find((a) => !a.getAttribute("href")?.startsWith("#"))!;
    fireEvent.click(otherTab);
    expect(confirm).toHaveBeenCalledOnce();
    expect(notes).toHaveValue("Recheck discomfort after walking");
    confirm.mockRestore();
  });
});
