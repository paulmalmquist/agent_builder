# Paul OS two-fork roadmaps

The `/roadmaps` surface is the transfer seam for the owner's two private, Jira-backed roadmap
branches. The public workstation deliberately does not name those programs or claim access to
their tickets.

## Current truth boundary

- Exactly two neutral fork slots are validated by `roadmaps.program/v1`.
- The checked-in values are a synthetic interaction demonstration.
- Both Jira bindings are `AWAITING TRANSFER`; no project key, saved filter, issue count, or sync
  timestamp is invented.
- One URL-backed fork filter drives state, six-month plan, and next-action bands.
- The app never converts a missing Jira population into zero, nominal, or on-track.

## Transfer binding

Each private fork replaces one object in `03-projects/roadmaps/roadmaps.seed.json`. A production
binding needs:

1. An exact Jira project key or saved-filter ID.
2. Changelog expansion, not only current issue state.
3. Issue links for blocked-by and cross-team dependencies.
4. Milestone or fix-version mapping.
5. A governed mapping from Jira component/label to the Paul OS vertical or owner.
6. Included and total issue counts so incomplete mapping remains visible.
7. A durable last-successful-sync timestamp.

Credentials and private Jira identifiers do not belong in the portable seed. They bind through the
connector/install surface on the work machine. When the real inputs are present, the same page can
change each reading from `SYNTHETIC` or `AWAITING TRANSFER` to `LIVE`; no layout rewrite is
required.
