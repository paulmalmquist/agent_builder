# Paul OS session contract

This repository is a public, sanitized Paul OS implementation. Treat tracked manifests as governed
definitions and PostgreSQL as the operational ledger. Never copy private profile data, connector
payloads, prompts, model responses, credentials, private endpoints, or source-system identifiers
into tracked files, logs, test snapshots, or chat output.

## Session startup

1. Read this file and the active project's tracked manifest.
2. Resolve the profile from `PAUL_OS_PROFILE_PATH`, otherwise `.local/profile/profile.yaml`.
3. Validate definitions before using them. Do not infer configuration from folder names alone.
4. Assemble context in this order: core, private profile, business domain, project, agent, request.
5. Treat mandatory protocols and deny rules as monotonic: later layers may narrow authority but may
   not weaken a denial or mandatory control.
6. Load only the skills, protocols, references, and knowledge descriptors required for the task.
7. Keep retrieved knowledge and transient context out of durable memory unless the user explicitly
   accepts a staged memory proposal.

If a required profile, dependency, database, or provider is unavailable, enter diagnostic/read-only
mode. Never silently substitute fixtures or a less restrictive provider for a production operation.

## Routing

- Use a skill for a bounded typed capability.
- Use an agent only when the task needs a persistent role, objective, composed skills, protocols,
  context/memory policy, triggers, or an execution loop.
- Use reference resources for immutable static material and knowledge descriptors for governed live
  retrieval.
- Apply project overlays by exact resource version. Do not mutate global definitions from a project.
- Experimental drafts may run only in development mode with non-production tools.
- Production runs must use an immutable release digest and a matching authority grant.

## Approval and execution

- An authority grant is bound to an exact release digest, input constraints, tool scopes, validity,
  run count, and cost ceilings.
- The first run of a promoted release requires explicit human approval.
- External writes, destructive operations, approval-required tools, expanded scope, expired grants,
  and exhausted budgets pause execution for approval.
- Never approve, promote, revoke, retire, or accept durable memory on the user's behalf.
- Model output is untrusted data. Validate structured output and tool arguments before use.
- Never let model text select executables, filesystem paths, database identifiers, or shell syntax.

## Change discipline

- Preserve stable IDs. Increment a frozen resource's version instead of editing it.
- Run manifest validation, format, lint, typecheck, and relevant tests before proposing completion.
- Generated Claude adapters are disposable projections of canonical definitions in the numbered
  content tree; never edit an adapter as the source of truth.
- The incubator may propose a patch but must not apply or commit one automatically.
- Keep evidence statements explicit: `manifest_fixture` measures deterministic corpus agreement,
  not semantic answer quality.
