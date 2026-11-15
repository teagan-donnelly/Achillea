---
name: Achillea bedside interface
description: Synthetic nursing workflow with explicit human confirmation
colors:
  forest: "#163e32"
  forest-deep: "#103226"
  paper: "#fafaf5"
  ground: "#f4f6ef"
  sage: "#eaf0e6"
  text: "#20372c"
  muted: "#52655b"
  line: "#d9e2d8"
  terracotta: "#874c36"
typography:
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
  title:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
rounded:
  control: "10px"
  section: "14px"
  patient: "16px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
components:
  patient-header:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper}"
    rounded: "{rounded.patient}"
    padding: "28px"
---

# Achillea frontend design system

## Overview

Bedside software that makes source evidence and explicit nurse actions easy to distinguish. This is an Operate interface: prioritize patient identity, readable state, accessible controls and truthful simulated-data labels. The palette and compact mobile composition follow the user's written redesign brief; no reference-image fidelity or rendered review is claimed.

## Colors

Forest anchors patient identity, navigation and primary actions. Paper separates care surfaces from the light sage ground. Terracotta marks workflow attention without implying clinical triage. Status text, timestamps and reason disclosures accompany color.

## Typography

Existing self-hosted DM Sans at 400/600/700. Patient names use `clamp(1.65rem, 5vw, 2.3rem)`. Section titles are generally 1.125rem; controls use 1rem to avoid input zoom. Supporting timestamps use tabular numerals, with 0.75rem labels reserved for source metadata. New heading tracking stays at -0.03em or looser.

## Layout

Phone-first content with 16px gutters and a fixed bottom navigation preserving horizontal swipes. Patient detail has a 980px maximum; general content 1200px. At 760px and below, patient identification stacks and vital cards use two columns. At 360px and below, filters stack. At 1050px, rounds use three backend-ordered horizon columns. Evidence scrollers contain overflow; 24 hourly bars are grouped into six selectable four-hour targets of at least 44px, with contained horizontal scrolling on very narrow screens.

## Elevation & Depth

Care surfaces use the shared offset shadow `0 6px 24px rgb(25 52 35 / 7%)` rather than decorative halos. Data records inside sections use dividers and tonal areas instead of adding more elevated cards.

## Shapes

10px control corners, 14px care sections, 16px patient headers/cards. Focus is visibly outlined; disabled states stay distinct. Safe areas and reduced-motion preferences are respected.

## Components

CareSection uses a native button with `aria-expanded`/`aria-controls` and a hidden content region. PatientTimeline displays source records within a rolling 24-hour window, permits time/category selection, and retains original IDs and timestamps in disclosures. BackendActivity folds only consecutive monitoring-summary runs; exceptions preserve backend chronology. Task order and reasons come from the backend. Chart confirmation and movement review always require the existing explicit nurse actions.

## Do's and Don'ts

- Do show missing, stale, delayed and disconnected evidence honestly.
- Do distinguish detected movement, nursing review and documented care completion.
- Do preserve textual statuses, keyboard access and working swipe gestures.
- Don't invent medication records, vital values, hardware integration or urgency scores.
- Don't treat source inspection, rendered mobile layout, or image fidelity as verified by component tests.
