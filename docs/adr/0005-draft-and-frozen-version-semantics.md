# ADR 0005: Mutable drafts and immutable candidates

- Status: Accepted
- Date: 2026-08-16

## Context

Immutability is essential for evidence and production reproducibility, but forcing a new semantic
version for every experiment makes individual iteration unnecessarily expensive.

## Decision

Experimental drafts are mutable. Each save increments a revision and records a content hash. Local
draft execution is permitted only in development mode with non-production tools and is visibly
marked unevaluated.

Transition to `candidate` freezes the version. Evaluation, certification, release, and production
refer to the frozen digest. Any later change creates a successor version. Certified and production
versions are immutable.

## Consequences

- Experimentation remains fast.
- Evidence and production runs are reproducible.
- Draft history is not promotion evidence.
- The compiler and database must reject content changes for frozen versions.
