# ADR 0004: Context precedence and monotonic policy

- Status: Accepted
- Date: 2026-08-16

## Context

Context will combine platform rules, a private user profile, domain and project configuration,
agent policy, and request data. Without deterministic precedence, identical runs may receive
different authority or silently lose safety constraints.

## Decision

Assemble context in this order:

`core → private profile → business domain → project → agent → session/request`

Later layers may refine values and narrow permissions. They cannot weaken a deny rule or remove a
mandatory protocol from an earlier layer. Every context item records its source, version, timestamp,
classification, and token contribution. Required context is fail-closed; optional context may be
omitted with an explicit diagnostic.

Knowledge retrieval remains separate from context assembly, static reference remains immutable, and
durable memory enters context only after human acceptance.

## Consequences

- Context assembly is deterministic and testable.
- Provenance and token budgets can be inspected before provider execution.
- Merge logic needs explicit per-field semantics; object spreading is insufficient.
