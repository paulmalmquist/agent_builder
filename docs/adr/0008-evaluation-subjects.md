# ADR 0008: Evaluation subjects use resource-version foreign keys

- Status: Accepted
- Date: 2026-08-16

## Context

Evaluations must cover skills, agents, protocols, and complete release bundles. An unchecked
`kind + id` pair is easy to create in Prisma but cannot provide referential integrity.

## Decision

Every evaluation run references `subjectVersionId → ResourceVersion` and, when paired comparison is
required, `comparisonVersionId → ResourceVersion`. Bundle evaluation uses a dedicated nullable
`subjectReleaseId → ReleaseBundle`; exactly one subject form is required by a database check.

Services validate allowed subject kinds for each executor and gate configuration. Runs snapshot the
subject digest, executor identity, corpus, gate configuration, provider metadata, and cost policy.

## Consequences

- Subjects cannot point to nonexistent or mistyped resources.
- Shared evaluation history works across resource kinds.
- Bundle evaluation remains first-class without pretending a bundle is a resource version.
- Existing agent certification evidence requires a preserving backfill.
