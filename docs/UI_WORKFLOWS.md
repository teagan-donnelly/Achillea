# Nurse workspace workflows

Achillea is a synthetic demonstration, not a clinical record system for real patient care. The five tabs share the same Spring Boot records: **Patients · Tasks · Monitoring · Handoff · Settings**. Monitoring retains its existing live feed and bedside simulator integration.

## Find and review a patient

1. Open **Patients** and search by name, room, or identifier. The directory uses the demo nurse's accessible assignments; changing the unit does not grant access to other patients.
2. Open a patient. **Summary** shows available clinical context and bedside care controls. Missing admission dates, diagnoses, allergies, and demographics are not filled with guesses.
3. Use **Timeline** for dated documentation, completed care, reviewed movements, and significant recorded events. Load older entries progressively.
4. Use **Trends** to select **24H**, **7D**, or **Full stay**, then swipe between available measurements. Full stay requests the backend's available persisted history. Coverage notes identify stored dates or a limited fallback; gaps are not filled with invented readings.
5. Use **Records** to read documentation, save a draft, explicitly confirm reviewed documentation, or append an amendment. An amendment preserves the original entry.

Returning to the directory restores the saved search and scroll position within the browser session.

The directory's document action opens care documentation for that patient directly. Monitoring detail also offers **Document care**, so the nurse can begin a note from the information being reviewed instead of returning through the directory. Bottom navigation keeps text labels visible for all five destinations.

## Record care with fewer steps

- Start with the observation or nurse narrative. Additional fields and linked evidence remain available without getting in the way of writing the note.
- The documentation sheet identifies the patient and room before the narrative and keeps its save/review actions in a persistent footer while the fields scroll.
- **Ctrl/Cmd + Enter saves a draft only**. It never confirms an entry, verifies care, completes a task, or acknowledges a handoff. Review and confirmation remain explicit actions.
- Saved drafts and confirmed chart entries stay distinct. Confirming a reviewed entry records it through Spring Boot; appending an amendment preserves the original entry.
- Monitoring cards display old, delayed, disconnected, and unavailable measurement states directly. Missing or disconnected readings do not appear as numeric current values. Room labels and named **All**, **Attention**, and **Stable** filters support quick scanning.

## Review and complete care

- **Tasks** groups the backend's open queue into **Overdue**, **Due Now**, and **Upcoming**. **Completed today** expands recent completed work; **History** retains older completions with patient and date filters. “Today” follows the displayed demo clock and local calendar, not an assumed staffing shift.
- Open a task to review the patient, due time, context, priority, and supported actions. The completion circle opens verification; it does not immediately complete care.
- Choose **Document** when a separate clinical entry is needed. For ordinary task completion, an optional note and bedside verification are saved through the existing completion endpoint, which records completion time and a linked chart entry. The same saved care appears in the patient's history and Handoff context.
- Repositioning completion additionally requires a previously nurse-confirmed movement for that patient. If none is available, use **Review movement and bedside care** first. Sensor detection alone does not verify care, and a movement already used for completed care cannot satisfy another completion.
- **Defer** requires a reason and moves the review due time to 30 minutes after saving, matching the backend's rule. Priority changes are explicit nurse actions, not generated clinical orders.
- Handoff outstanding-care links open the original task in **Tasks**. They do not create another task or require a second completion note.
- Scheduling a review uses the selected patient when one is selected. **In 15 min**, **In 30 min**, and **In 1 hour** shortcuts fill the due time; the nurse still enters the review and explicitly schedules it. Exact date/time entry remains available.

## Prepare and receive a handoff

1. Open **Handoff**. **Outgoing** contains reports being prepared, **Incoming** contains reports awaiting review, and **History** retains previous reports.
2. Start or open a report for an accessible patient. Review the documented situation and background, chronological care during the report window, and outstanding original tasks.
3. Enter structured notes for current concerns, changes, interventions and response, follow-up, next-shift priorities, and additional observations. Save a draft before progressing.
4. Move the report explicitly through **Draft → Ready → Reviewed → Acknowledged**. Opening a report never acknowledges it. Acknowledgment requires explicit verification.
5. Review saved versions and prior reports when needed. Saved edits append version history with authorship and timestamps instead of replacing prior documentation.

Sensor events remain identified separately from nurse documentation. Live patient context is not presented as a nurse-authored summary. Unsaved notes must be saved before a status transition.

Search Handoff by patient name, room, or identifier. The search stays in the URL when switching lists or opening and returning from a report. Inside a report, section shortcuts jump to notes, open care, and this shift's history. The sticky header retains patient/room context and saves a draft without scrolling to the end. **Ctrl/Cmd + Enter** also saves while writing notes. Inputs pause during a save so a delayed response cannot replace newly typed text; saving never advances the report's status automatically.

## Settings and current limits

- **Settings** changes the current care unit and displays the demo workspace identity. Authentication, real nurse account switching, and notification preferences are not connected; there are no pretend preference toggles.
- Handoff uses the existing demo nurse identity. Its default Day/Night report windows are 07:00–19:00 and 19:00–07:00; these are demo conventions, not an integrated staffing roster.
- History covers records actually retained in the selected backend database. It cannot recover data from another database, a reset, periods without simulator ingestion, or measurements never supplied. “Full stay” means all available stored measurements, not a verified admission-to-discharge record.
- The current backend uses its existing relational store and local H2 configuration. These UI changes do not establish a Tiger Data or Typesense connection.
- Historical measurement availability depends on the running backend. If its series endpoint is unavailable, the UI identifies any recent-reading fallback as partial history. Unsupported historical data remains unavailable.
- Browser session storage preserves navigation and local draft convenience; a successful backend save is required for a persisted clinical or handoff record.
- Handoff prompts before following app links or reloading with unsaved notes. Browser back/forward gestures do not trigger that prompt; save the draft before using browser history.

## Developer checks

Use Java 21, Maven, and the Node version specified in [RUN_LOCALLY.md](../RUN_LOCALLY.md). Run these from the repository root:

```powershell
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
mvn -f backend/pom.xml test
```

For the full local simulator workflow, follow [RUN_LOCALLY.md](../RUN_LOCALLY.md). Review the rendered application at 320, 375, 390, 430, and 768 pixels and a desktop width. Check long names and task titles, keyboard focus, bottom-sheet scrolling and dismissal, safe-area spacing, original-task links, saved drafts, and explicit verification. Automated component tests do not replace a visual review on an actual phone.
