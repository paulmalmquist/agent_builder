# ADR 0006: Bounded authority envelopes

- Status: Accepted
- Date: 2026-08-16

## Context

Requiring approval for every scheduled run prevents useful automation. Allowing an agent unlimited
standing authority is unsafe and makes changes difficult to audit.

## Decision

A human may grant a bounded authority envelope tied to an exact release digest, project, input
constraints, tool scopes, validity window, maximum run count, per-run cost ceiling, total cost
budget, and actor. The first production run of a newly promoted release always requires approval.

Later matching runs may execute unattended. Expiration, revocation, exhausted budget, changed
digest, expanded inputs, approval-required tools, external writes, or destructive actions pause and
create a new approval request. A grant cannot approve or extend itself.

## Consequences

- Recurring read-only workflows can be genuine automations.
- Approval evidence is reusable but tightly bounded.
- Claiming a run and consuming grant budget must be atomic.
- Cost estimation, cancellation, and immediate revocation become runtime requirements.
