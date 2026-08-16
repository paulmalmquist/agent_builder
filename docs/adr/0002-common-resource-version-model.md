# ADR 0002: Common resource-version model

- Status: Accepted
- Date: 2026-08-16

## Context

Skills, agents, protocols, tools, automations, projects, references, and knowledge descriptors share
identity, versioning, provenance, lifecycle, dependency, release, and evaluation needs. Separate
unrelated registries would duplicate invariants and make release composition difficult.

## Decision

Use `ResourceFamily` for stable identity and `ResourceVersion` for a concrete immutable candidate.
Kind-specific one-to-one definitions hold specialized configuration. `ReleaseBundle` and
`ReleaseResource` pin an exact dependency closure. `RepositoryImport` records source commit, digest,
actor, and validation result.

Every manifest includes `apiVersion`, kind, stable UUID, slug, semantic version, owner, purpose,
lifecycle, provenance, exact dependencies, and a kind-specific `spec` object.

## Consequences

- Release, evaluation, provenance, and lookup behavior can be shared.
- Kind-specific validation remains explicit rather than becoming an untyped property bag.
- Existing agent IDs must be preserved during backfill.
- Database constraints and services must prevent cross-kind relation mistakes.
