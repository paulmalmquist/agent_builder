# ADR 0009: Legacy API compatibility has a fixed sunset

- Status: Accepted
- Date: 2026-08-16

## Context

The current frontend is the only known consumer of the existing `/agents` API. Permanent adapters
would double contract maintenance without protecting an external integration, but compatibility
snapshots are valuable while storage and UI migrate.

## Decision

- M0–M4: retain `/agents` under contract and critical-flow snapshot coverage.
- M4: move the frontend to the common `/v1` resources.
- M5: run final parity checks, remove the legacy adapters, and delete legacy snapshots in the same
  intentional cutover.

No new feature is added exclusively to the legacy surface. A temporary response header and startup
log will announce the scheduled removal once `/v1` reaches parity.

## Consequences

- Structural work has an executable compatibility harness.
- The platform does not carry two APIs indefinitely.
- Cutover is a named milestone with explicit exit evidence rather than an informal cleanup task.
