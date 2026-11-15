import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BottomSheet, Segmented } from "./ui";
import { SettingsView } from "./SettingsView";

afterEach(cleanup);

describe("nursing sheet keyboard access", () => {
  it("keeps the cursor in the notes through parent rerenders and uses the latest Escape callback", () => {
    const closed = vi.fn();
    function Editor() {
      const [notes, setNotes] = useState("");
      return (
        <BottomSheet open title="Document care" onClose={() => closed(notes)}>
          <label>
            Care notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </BottomSheet>
      );
    }
    render(<Editor />);
    const notes = screen.getByRole("textbox", { name: "Care notes" });
    notes.focus();
    fireEvent.change(notes, { target: { value: "Turned left" } });
    expect(notes).toHaveFocus();
    fireEvent.change(notes, {
      target: { value: "Turned left, tolerated well" },
    });
    expect(notes).toHaveFocus();
    fireEvent.keyDown(notes, { key: "Escape" });
    expect(closed).toHaveBeenCalledExactlyOnceWith(
      "Turned left, tolerated well",
    );
  });

  it("restores the opener, background interaction and existing scroll state on close", () => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "clip";
    function Workspace() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Review care</button>
          <BottomSheet
            open={open}
            title="Review task"
            onClose={() => setOpen(false)}
          >
            <button>Verify care</button>
          </BottomSheet>
        </>
      );
    }
    const { container } = render(<Workspace />);
    const opener = screen.getByRole("button", { name: "Review care" });
    const previousInert = container.inert;
    opener.focus();
    fireEvent.click(opener);
    expect(container.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    expect(screen.getByRole("dialog", { name: "Review task" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(container.inert).toBe(previousInert);
    expect(document.body.style.overflow).toBe("clip");
    document.body.style.overflow = originalOverflow;
  });

  it("wraps Shift+Tab from the initial dialog to the last enabled action", () => {
    render(
      <BottomSheet
        open
        title="Review care"
        onClose={vi.fn()}
        footer={<button>Save care</button>}
      >
        <button disabled>Unavailable action</button>
        <textarea aria-label="Care notes" />
      </BottomSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Review care" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    const save = screen.getByRole("button", { name: "Save care" });
    expect(save).toHaveFocus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  });

  it("restores a background that was already inert when the sheet unmounts", () => {
    const background = document.createElement("aside");
    background.inert = true;
    document.body.append(background);
    const { unmount } = render(
      <BottomSheet open title="Care" onClose={vi.fn()}>
        Details
      </BottomSheet>,
    );
    expect(background.inert).toBe(true);
    unmount();
    expect(background.inert).toBe(true);
    background.remove();
  });
});

describe("compact nurse workspace controls", () => {
  it("moves both focus and selection with arrow, Home and End keys", () => {
    function Sections() {
      const [value, setValue] = useState("summary");
      return (
        <Segmented
          label="Patient record"
          value={value}
          onChange={setValue}
          options={[
            { value: "summary", label: "Summary" },
            { value: "timeline", label: "Timeline" },
            { value: "records", label: "Records" },
          ]}
        />
      );
    }
    render(<Sections />);
    const summary = screen.getByRole("tab", { name: "Summary" });
    const timeline = screen.getByRole("tab", { name: "Timeline" });
    const records = screen.getByRole("tab", { name: "Records" });
    summary.focus();
    fireEvent.keyDown(summary, { key: "ArrowRight" });
    expect(timeline).toHaveFocus();
    expect(timeline).toHaveAttribute("aria-selected", "true");
    expect(summary).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(timeline, { key: "End" });
    expect(records).toHaveFocus();
    fireEvent.keyDown(records, { key: "ArrowRight" });
    expect(summary).toHaveFocus();
    fireEvent.keyDown(summary, { key: "ArrowLeft" });
    expect(records).toHaveFocus();
    fireEvent.keyDown(records, { key: "Home" });
    expect(summary).toHaveFocus();
    expect(summary).toHaveAttribute("aria-selected", "true");
  });

  it("has no care unit selector in Settings", () => {
    const selectUnit = vi.fn();
    render(
      <SettingsView
        label="Labor & delivery"
        unit="L_AND_D"
        selectUnit={selectUnit}
      />,
    );
    expect(screen.queryByRole("combobox", { name: "Care unit" })).not.toBeInTheDocument();
  });
});
