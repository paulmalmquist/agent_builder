# ADR 0011: Workspace-local uniqueness boundary

## Status

Accepted for the proposal-ready isolation prototype.

## Decision

Names, ordinals, aliases, and caller-supplied idempotency keys identify records inside a workspace or
inside a globally unique owning aggregate. They must not prevent an unrelated workspace from using
the same value.

The following database identities are workspace-local:

| Table                     | Local identity                                                  |
| ------------------------- | --------------------------------------------------------------- |
| `AgentFamily`             | `(workspaceId, slug)`                                           |
| `KnowledgeSource`         | primary key `(workspaceId, id)`                                 |
| `CertificationGateConfig` | `(workspaceId, version)` and one active row per workspace       |
| `EvalCase`                | `(workspaceId, key)`                                            |
| `EvalCorpusVersion`       | `(workspaceId, version)`                                        |
| `ResourceFamily`          | `(workspaceId, kind, slug)`                                     |
| `ProductionChannel`       | primary key `(workspaceId, key)` and `(workspaceId, projectId)` |
| `ExecutionRun`            | `(workspaceId, idempotencyKey)`                                 |
| `PluginInvocation`        | `(workspaceId, invocationKey, sequence)`                        |
| `RunPluginCallPlan`       | `(workspaceId, invocationKey)`                                  |
| `Observation`             | `(workspaceId, signalKey)`                                      |
| `DigestDeliveryAttempt`   | `(workspaceId, attemptKey)`                                     |
| `CatalogIndexOutbox`      | `(workspaceId, idempotencyKey)`                                 |
| `BuilderDecision`         | `(workspaceId, idempotencyKey)`                                 |

Some child records do not duplicate workspace scope. Their natural key is prefixed by the owning
aggregate's globally unique UUID:

| Table                | Owner-local identity                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| `Agent`              | `(familyId, slug)`; version identity remains `(familyId, versionNumber)` |
| `CertificationRun`   | `(familyId, nightlyScheduleKey)`                                         |
| `RunStep`            | `(runId, idempotencyKey)`                                                |
| `AutomationDispatch` | `(scheduleId, idempotencyKey)` and `(scheduleId, scheduledFor)`          |

Foreign keys for `KnowledgeSource` links and production-channel consumers include `workspaceId`.
This makes cross-workspace binding a database error, not merely a repository convention.

## Intentionally global identities

- `Workspace.slug` is a control-plane directory key.
- `ResourceVersion.digest`, `ReleaseBundle.digest`, and `EvalCorpusVersion.contentHash` are immutable
  content addresses.
- UUID-backed one-to-one constraints such as decision, run, release, and resource references enforce
  relational cardinality rather than a human namespace.
- `PlatformEvent.sequence` is a global monotonically increasing ledger cursor.

## Deferred direct scope columns

`Agent` and `CertificationRun` still inherit workspace identity through `AgentFamily`. Adding a second
stored workspace value before the legacy `/agents` sunset would create duplicate scope authority and
would require compound foreign keys across the complete certification lineage. Their slug and nightly
schedule keys are family-local now, which removes cross-workspace collisions while preserving a single
scope source. Direct workspace columns and constraints are deferred to the legacy-table cutover.

## Verification

The forward migration is exercised against populated and empty PostgreSQL databases. A database
integration test creates identical governed names, version numbers, channel aliases, observations,
and Builder idempotency keys in two workspaces, confirms same-workspace duplicates still fail, and
asserts the operational idempotency indexes contain their workspace or owning-aggregate prefix.
