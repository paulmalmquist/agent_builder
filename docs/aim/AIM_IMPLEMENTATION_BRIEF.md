# AIM Implementation Brief

## Purpose

AIM is a manifest-driven manufacturing capability map inside Paul OS. It starts with the operating
group, then shows the literal hardware that group owns, how each part is made, and which governed
agent examples cover it. Certification, connector reach, and evidence remain visible as separate
claims so the interface never turns a modeled relationship into a live deployment claim.

The checked-in implementation is employer-neutral. It contains no protected design data,
proprietary subsystem detail, organizational scorecard, operational source identifier, or live
connection.

## Contract baseline

The baseline establishes one source of truth before presentation:

- a strict `aim.program/v2` contract and portable JSON Schema;
- a sanitized seed containing the complete declared hardware, group, and agent relationships;
- literal hardware labels with manufacturing method, process, canonical owner, and coverage
  references;
- six ordered primary groups plus supporting groups, with Quality and Avionics and safety
  first-class;
- explicitly synthetic agent examples using the accepted R0–R4 authority ladder and neutral
  offline connector marks;
- deterministic validation and normalization;
- evidence freshness and GO eligibility policy;
- pure historical and forecast projection through `stateAt(manifest, time)`;
- derived coverage and date-to-date program diff;
- static and caller-supplied local-text adapters only;
- package-level contract and state-engine tests.

The source lifecycle remains visible even when evidence is incomplete. Agent counts, certification
coverage, evidence age, readiness, and changes are derived rather than duplicated in the manifest.
A certified label counts toward group coverage only while its declared evidence remains current and
non-conflicting.

## Frontend consumption contract

The frontend imports `loadAimProgram` and `stateAt` from the browser-safe
`@paul-os/runtime/aim` subpath. It receives `AimProgramViewModel`, selects the six primary groups by
`kind`, sorts them by `displayOrder`, and derives hardware from `ownerGroupId`.

The static interface keeps one clear progression:

1. choose a primary owning group;
2. inspect its hardware and declared manufacturing method;
3. optionally select one part to filter modeled agents and connector reach;
4. open evidence only through an explicit read-only action.

The frontend must not:

- fetch or open source and evidence locations;
- write back to the program manifest;
- infer deployment, certification, or authority beyond the declared evidence;
- hide validation or evidence warnings;
- make a public runtime request.

## Explicitly deferred

- Live system adapters, remote APIs, and event infrastructure.
- CSV and work-item import converters with reconciliation reports.
- Protected engineering data.
- Production authorization, actuator control, or automated source writes.
- Organization-level performance ranking.
- Full guided presentation, roadmap controls, and QBR interaction beyond the pure diff contract.

See [Repository Integration Notes](./REPO_INTEGRATION_NOTES.md) for actual package locations,
commands, and editing rules.
