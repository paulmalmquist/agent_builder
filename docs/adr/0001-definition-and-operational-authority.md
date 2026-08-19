# ADR 0001: Git definitions and PostgreSQL operational authority

- Status: Accepted
- Date: 2026-08-16

## Context

Paul OS needs reviewable, portable definitions and a durable concurrent ledger. Treating either Git
or PostgreSQL as the authority for everything creates an awkward authoring or execution model.

## Decision

Tracked manifests are authoritative for resource definitions. PostgreSQL is authoritative for
imports, immutable release bundles, runs, approvals, schedules, audit events, evidence, outcomes,
metrics, and accepted memory.

The compiler validates a manifest, resolves exact dependency versions, canonicalizes it, and derives
a digest. Import records the source commit and digest. Production executes only an imported release
digest; it never interprets mutable repository files at run time.

Private profile overlays are not tracked in the public repository. They are resolved from
`.local/profile/` or `PAUL_OS_PROFILE_PATH` and are backed up separately.

## Consequences

- Definitions are diffable and recoverable through Git.
- Operational facts support transactions, concurrency, retention, and audit queries.
- A repository edit cannot silently alter a production run.
- Import and drift checks are required between the two authorities.
