# AIM Implementation Brief

## Purpose

AIM is a manifest-driven program visualization inside Paul OS. A synthetic two-stage capability vehicle represents incremental, evidence-gated capability delivery. It is a conceptual interface, not a technical vehicle model.

> CONCEPTUAL GEOMETRY — NOT VEHICLE CAD

The checked-in implementation is employer-neutral. It contains no authentic geometry, proprietary subsystem design, organizational scorecard, operational source identifier, or live connection.

## Phase 0–1 baseline

The baseline establishes one source of truth before rendering:

- a strict `aim.program/v1` contract and portable JSON Schema;
- a sanitized seed containing the complete named vehicle and ground anchor cast;
- deterministic validation and normalization;
- evidence freshness and GO eligibility policy;
- pure historical/forecast projection through `stateAt(manifest, time)`;
- derived visual state and date-to-date program diff;
- static and caller-supplied local-text adapters only;
- package-level contract and state-engine tests.

The source lifecycle remains visible even when evidence is incomplete. Visual material, readiness treatment, tank fill, print speed, heartbeat, seams, and changes are derived rather than duplicated in the manifest.

## Phase 2 consumption contract

The renderer imports `loadAimProgram` and `stateAt` from the browser-safe `@paul-os/runtime/aim` subpath. It receives `AimProgramViewModel`, resolves each part's `anchorId`, and maps the supplied `visual` object to scene presentation. It must provide exact-anchor, alias, region, and clickable-fallback resolution; resource disposal; reduced motion; capped device pixel ratio; WebGL failure handling; and an accessible two-dimensional summary.

The renderer must not:

- infer program status from geometry;
- fetch or open source/evidence locations;
- write back to the program manifest;
- present proxy geometry as authentic;
- hide validation or evidence warnings;
- make a public runtime request.

## Explicitly deferred

- Live system adapters, remote APIs, and event infrastructure.
- CSV and work-item import converters with reconciliation reports.
- Authentic or protected geometry.
- Production authorization, actuator control, or automated source writes.
- Organization-level performance ranking.
- Full guided presentation, roadmap controls, and QBR interaction beyond the pure diff contract.

See [Repository Integration Notes](./REPO_INTEGRATION_NOTES.md) for actual package locations, commands, and editing rules.
