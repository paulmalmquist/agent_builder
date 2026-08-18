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

## Numbered navigation

Paul OS uses its numbered architecture as navigation identity:

- `00` Today
- `01` Attention
- `02` Knowledge
- `03` Build
- `04` Catalog
- `05` Operate
- `06` Connections
- `07` Evidence
- `08` Incubator
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

The public workstation can already traverse immutable resource definitions and exact dependency
pins. The interface groups Systems, Decisions, Datasets, Runbooks, Metrics, and Agents & Skills,
then shows related resources and the imported agents whose dependency closure touches an entity.

People and incident-system records are deliberately transfer-ready empty states. Private directory,
dataset, runbook, and incident content is added later through governed overlays; names, ownership,
and relationships are never inferred from folder names or arbitrary JSON.

The command palette searches the existing legacy agent catalog and the versioned resource index.
It does not invent results for entity types that have no current read contract.

## Visual language

- Numerals replace generic navigation icons.
- Drafting marks replace sparkle, wand, and robot motifs.
- Dense instrument typography keeps operational facts above the fold.
- Reduced motion remains mandatory.
- Purple indicates decisions; amber degradation and red safety stops include text and shape, not
  color alone.

## Acceptance

- Today changes with time and connected data.
- Missing sources remain visible and honest.
- The rail never overlaps content and remembers collapse state.
- All numbered destinations and legacy deep links remain reachable.
- Knowledge lists open and exact relationships can be traversed.
- Command-K returns governed entities as well as legacy agents.
- Attention alone owns decision mutation and badges.
