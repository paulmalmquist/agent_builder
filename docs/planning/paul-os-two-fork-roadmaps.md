# Paul OS two-fork roadmaps

The `/roadmaps` surface is the transfer seam for the owner's two private, Jira-backed roadmap
branches. The public workstation deliberately does not name those programs or claim access to
their tickets.

## Current truth boundary

- Exactly two neutral fork resources are validated by `roadmap.fork/v1`; the backend projects them
  through the complete `roadmaps.program/v2` read contract at `GET /v1/roadmaps`.
- The checked-in definitions and values are synthetic transfer fixtures, with exact immutable
  resource identity and dependency pins.
- Both Jira bindings are `AWAITING TRANSFER`; no project key, saved filter, issue count, or sync
  timestamp is invented.
- One URL-backed fork filter drives state, six-month plan, and next-action bands.
- Relationship coverage is explicit for program vertical, AIM group, contributing Agent versions,
  and execution runs. Absent edges remain `UNMAPPED` or `UNAVAILABLE`.
- The app never converts a missing Jira population into zero, nominal, or on-track.

## Transfer binding

The immutable fork definitions live in
`03-projects/roadmaps/fork-01/manifest.yaml` and
`03-projects/roadmaps/fork-02/manifest.yaml`. They declare stable fork identity, transfer-ready UI
shape, exact definition dependencies, typed directional relationships, and per-edge provenance.
They do not store operational execution-run edges or invent private Jira identities.

A production binding needs:

1. An exact Jira project key or saved-filter ID.
2. Changelog expansion, not only current issue state.
3. Issue links for blocked-by and cross-team dependencies.
4. Milestone or fix-version mapping.
5. A governed mapping from Jira component/label to the Paul OS vertical or owner.
6. Included and total issue counts so incomplete mapping remains visible.
7. A durable last-successful-sync timestamp.

Credentials and private Jira identifiers do not belong in portable manifests. They bind through the
connector/install surface on the work machine. Operational Jira snapshots—issue populations,
changelog-derived measurements, workstream state, and last-successful-sync evidence—belong in
Postgres behind a governed connector. A future snapshot adapter overlays those readings onto the
same exact Roadmap resource identities; it does not mutate their immutable definitions.

The current service intentionally projects only the governed synthetic and awaiting-transfer
definitions. It is not a live Jira integration. When a complete operational snapshot source is
added, the API can change readings from `SYNTHETIC` or `AWAITING TRANSFER` to `LIVE` without a UI
rewrite. Missing or partial snapshots continue to fail closed.
