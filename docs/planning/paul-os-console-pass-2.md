# Console Pass 2 — Today, Navigation, and Knowledge

This sanitized design record explains the operating-console refactor. Runtime truth remains in the
source, API contracts, tests, and accepted architecture decisions.

## Problem statement

The former Home explained the product through a hero and feature grid. That was useful as a product
introduction, but it did not answer the daily question: what is happening around me now?

The replacement treats time as the organizing axis. It merges only the connected, governed facts
available from Attention, execution runs, and automation schedules. A visible NOW marker separates
recorded activity from upcoming scheduled work. Meetings and project deadlines remain explicit
source gaps until private connectors are transferred.

## Design intent

The audience is a person doing governed engineering, manufacturing, data, or platform work—not a
buyer evaluating a landing page. The console must answer three questions quickly: what needs me now,
what is the system permitted to do, and what evidence explains what happened.

It should feel calm, exact, technical, and specific to Paul OS. Its identity comes from the numbered
architecture, drafting marks, time axis, evidence language, physical capability map, and connector
chassis. Generic feature grids, oversized marketing type, sparkle or robot imagery, and decorative
motion do not carry product meaning and are excluded. Components are refined independently against
their real operating task before being assembled into a screen.

## Numbered navigation

Paul OS uses its numbered architecture as navigation identity:

- `00` Today
- `01` Roadmaps
- `02` Attention
- `03` Build
- `04` Catalog
- `05` AIM
- `06` Operate
- `07` Connections
- `08` Evidence
- `09` Knowledge
- `10` Incubator
- Settings

The rail expands to labels and collapses to numerals. The `[` shortcut and the control both toggle
it, and the preference persists locally. Attention remains the only badged destination. The content
column reserves rail width at every scroll position; no floating navigation covers page content.

## Today

Today is a read-only launch surface, not a second control plane:

- Current local date and time-of-day weighting.
- One chronological timeline from real ledger and schedule data.
- A top-three, read-only Attention preview with one handoff to the full queue.
- The latest digest window, described relative to the last delivered briefing.
- Nonnominal operating exceptions only when successful API data supports them.
- A visible unavailable state for the fourteen-day decision-flow chart until its aggregate contract
  exists.

Every contributing query fails closed. An unavailable source never becomes a zero, an empty state,
or a nominal claim.

## Knowledge

The public workstation can already traverse immutable resource definitions and exact version-pinned
dependency edges. This is a definition graph, not a semantic knowledge graph. The interface groups
Systems, Decisions, Datasets, Runbooks, Metrics, and Agents & Skills, then shows the direction,
version, and declaring manifest for each loaded edge and the imported agents whose exact dependency
closure touches a definition.

People and incident-system records are deliberately transfer-boundary empty states. Private
directory, dataset, runbook, and incident content is added later through an independently
inspectable Extract, Resolve, Assemble, and Query pipeline. Names, ownership, identity merges, and
semantic relationships are never inferred from folder names, arbitrary JSON, or retrieval
similarity.

The command palette searches the existing legacy agent catalog and the versioned resource index.
It does not invent results for entity types that have no current read contract.

## Visual language

- Numerals replace generic navigation icons.
- Drafting marks replace sparkle, wand, and robot motifs.
- Dense instrument typography keeps operational facts above the fold.
- Reduced motion remains mandatory.
- Purple indicates decisions; amber degradation and red safety stops include text and shape, not
  color alone.
- Dense layouts must reflow at a 320 CSS-pixel viewport, keep focused controls visible, and preserve
  at least the WCAG 2.2 minimum target size or equivalent spacing.
- Custom marks and visual assets must explain structure, provenance, authority, or state; decoration
  never substitutes for operating evidence.

## Acceptance

- Today changes with time and connected data.
- Missing sources remain visible and honest.
- The rail never overlaps content and remembers collapse state.
- All numbered destinations and legacy deep links remain reachable.
- Knowledge lists open and exact definition dependencies can be traversed without implying semantic
  relationships.
- Command-K returns governed entities as well as legacy agents.
- Attention alone owns decision mutation and badges.
