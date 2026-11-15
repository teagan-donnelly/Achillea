---
name: Achillea mockup interface
description: Mobile bedside workflows with explicit human confirmation
colors:
  forest: "#174d3c"
  secondary: "#2e6b57"
  ivory: "#f8faf7"
  card: "#ffffff"
  sage: "#e4eee7"
  text: "#24352d"
  muted: "#58695e"
  line: "#e6ebe7"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontWeight: 500
    fontSize: "2rem"
    letterSpacing: "-0.025em"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
rounded:
  control: "10px"
  section: "14px"
  card: "16px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
components:
  page-hero:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.card}"
    padding: "20px"
---

# Achillea responsive design system

## Overview

The user's Achillea Nursing App UI Mockup.png governs this Operate interface. Translate its serif titles, forest-green heroes, ivory ground, white rounded cards, avatar identities, small purposeful icons and compact mobile navigation into real workflows. Do not copy the mockup's illustrative patient data or invent missing APIs. The prior lightweight redesign is superseded by frontend/src/responsive-design.css, scoped to .mockup-design.

## Colors

Forest #174D3C anchors page and patient identity, navigation and actions. Secondary #2E6B57 supports interactions. Ivory #F8FAF7 surrounds white cards. Sage #E4EEE7 and warm peach tints distinguish sources and attention; darker green/terracotta text preserves readability. Actual state labels and backend reasons accompany every priority treatment. No clinical urgency score is inferred.

## Typography

Self-hosted Fraunces 500/600 provides page heroes and patient-detail names. Existing DM Sans 400/600/700 carries body, cards, readings and controls. Phone titles use clamp(1.6rem,5vw,2rem); patient names use clamp(1.4rem,5.5vw,1.9rem). Source metadata is at least .75rem in the authoritative stylesheet; fields remain 1rem. Readings and timestamps use tabular numerals. Fraunces is SIL OFL 1.1; its copyright/license ships in frontend/public/licenses/Fraunces-OFL.txt.

## Layout

Mobile baseline has 16px gutters (10px below 360px), a compact header, forest-green heroes and floating white mobile navigation with measured safe-area clearance. Tablet starts at 768px with two patient-card columns. Desktop starts at 1024px with a 210px forest sidebar and 1160px bounded main region. Activity has queue/timeline plus a shift-summary column; bedside has monitoring/timeline plus care actions; Rounds has primary tasks and a 280px support column. Patient cards use three columns from 1550px. Components are shared across viewport sizes.

## Elevation & Depth

Cards use 0 3px 12px rgb(26 48 34 / 6%). Tonal strips and fine timeline connectors convey hierarchy inside cards without additional elevation. Header shapes are restrained geometric color fields drawn as SVG; they are not medical evidence or photographs.

## Shapes

16px card corners, 14px expandable sections and 10px controls. Primary touch controls remain at least 44px. Evidence and timeline scrollers contain horizontal overflow and cannot initiate page swipe navigation. Visible focus and reduced motion remain supported.

## Components

PageHero, HeroShape and PatientAvatar establish the mockup's identity. CareSection uses a real button with aria-expanded/aria-controls and an icon/tinted background. Patient vitals sit in one white panel beneath the hero, with only supported measurements and actual recorded trends. TimelineRail groups recent real records by hour/category, displays the latest six groups, uses real timestamps and permits evidence selection; marker spacing supports touch and is not a proportional time scale. View all reveals complete source history and filters. BackendActivity preserves backend chronology and folds only consecutive monitoring summaries. Rounds preserves Now/Next/Later ordering and all explicit task actions. Sensor Review distinguishes source evidence, nurse review, care confirmation and resulting documentation.

## Do's and Don'ts

- Do use the supplied mockup's composition rather than reskinning the old dashboard.
- Do keep synthetic-data warnings, source availability, timestamps, pending reviews and explicit confirmation controls visible.
- Do retain textual statuses and backend priorities, keyboard navigation, swipes and safe areas.
- Don't fabricate medication, handoff, blood-pressure or hardware records to fill the mockup.
- Don't claim all viewport layouts or image fidelity were visually tested by component tests. The user confirmed the new interface is visible; automated browser inspection remains prohibited.

## Floating navigation refinement

The floating-nav-polish brief refines the established identity rather than replacing it. frontend/src/floating-nav.css loads last, scoped to .minimal-design. Forest #174D3C and dark forest #10392C anchor actions and desktop navigation; #F8FAF7 is the ground and #E4EEE7 the sage. Muted text stays #58695E for readable contrast. Fraunces and DM Sans remain self-hosted. Cards use softer elevation, fewer inner borders and restrained white surfaces; clinical status text and terracotta urgency are retained.

Below 1024px one shared navigation becomes a centered white floating pill, up to 380px wide. Four fixed icon/link centers are measured. Only the green indicator translates; pointer capture supports continuous bounded movement, with one route committed on release. Cancellation, capture loss, resize, visibility changes and window blur restore the selected route. Icons whiten only when the dragging circle covers them. The 240ms transition is removed during dragging and for reduced motion. All four labels remain visible and links retain aria-current and keyboard access.

The pill sits 12px above the bottom safe inset; content padding uses its observed height plus the gap and safe inset. From 1024px the same links become a compact forest sidebar; the indicator is hidden. Preferences store local UI state only, never monitoring snapshots or care verification. Care checkboxes must be reviewed again after leaving and returning. Scrolling is restored per unit/path while current clinical data refreshes through existing APIs.

Visual QA at actual viewport sizes remains unverified because browser automation is prohibited. Pointer/route/retention tests use jsdom with explicit geometry; they do not certify rendered iPhone appearance.
