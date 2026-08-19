# ADR 0012: Definition, knowledge, and execution graph integrity

## Status

Accepted as the transfer boundary. The semantic knowledge graph remains unimplemented in the public
workstation; the versioned definition graph and immutable execution plans are implemented.

## Decision

Paul OS uses three different graphs and never presents one as another:

1. The **definition graph** is the exact, acyclic `familyId@version` dependency graph imported from
   governed manifests. It can answer which versioned definition depends on another definition. It
   cannot claim that two business entities are identical or that a real-world causal relationship
   exists.
2. The future **semantic knowledge graph** connects canonical organizational entities through typed,
   source-backed facts. It is populated only through the staged pipeline below.
3. The **execution graph** is the immutable plan and recorded state-transition history for one run.
   It controls what may happen next; model output cannot rewrite it.

Keeping these identities separate prevents a convenient UI traversal, fuzzy name match, or model
suggestion from silently becoming organizational truth or execution authority.

## Semantic pipeline

The transfer implementation must keep four stages independently inspectable:

| Stage    | Durable result                                                                 |
| -------- | ------------------------------------------------------------------------------ |
| Extract  | Candidate entities and subject-predicate-object facts tied to one source slice |
| Resolve  | Versioned merge/split decisions with evidence and reviewer state               |
| Assemble | Canonical nodes and typed edges accepted from resolved candidates              |
| Query    | A bounded subgraph plus the exact edge and source citations used in the answer |

Extraction and resolution are proposals, not facts. A model may propose aliases or relationships but
cannot write directly into the canonical graph. Ambiguous matches remain separate until a governed
resolution accepts a merge. A later split or correction supersedes prior resolution evidence instead
of deleting history.

Every canonical edge must retain:

- stable subject and object entity IDs;
- an allowlisted predicate and direction;
- the exact source artifact and source version;
- the source location or bounded evidence slice;
- extraction schema, prompt, and model versions;
- extraction and resolution timestamps;
- resolution state and actor when review was required; and
- effective-time bounds when the source describes a time-varying fact.

Confidence is diagnostic evidence, not permission to omit provenance or promote a candidate
automatically. Tests must measure false merges and missed merges separately against a reviewed corpus.

## Query boundary

Graph queries are server-owned traversals with allowlisted predicates and explicit depth, row, byte,
time, and cost ceilings. Returned claims cite the exact graph edges and their source versions. Missing
paths produce `unknown` or an explicit coverage gap; retrieval similarity is never treated as proof of
a relationship. Model text cannot select executable query syntax, identifiers, or unrestricted graph
patterns.

## Execution boundary

Consequential runs use these commitments:

- **Immutable plan:** the server snapshots the exact release, entrypoint, input contract, context,
  Plugin call plans, scopes, budgets, idempotency keys, maximum attempts, and retry strategy before
  execution.
- **Separated roles:** backend planning/materialization, worker execution, evaluation, and recovery are
  separate code paths with separate evidence. An executing model cannot approve or grade its own work.
- **Strict escalation:** failures follow typed transitions and bounded retry policy. Exhaustion,
  ambiguous external effects, broadened authority, or missing evidence pauses or terminalizes the run;
  none permits an improvised loop or blind replay.

The current worker satisfies this boundary for the deterministic daily-brief path and immutable
pre-model Plugin hydration plans. It is not a general model-authored workflow graph, and the console
must not claim otherwise.

Plugin outputs remain transient and the evidence ledger stores digests rather than replayable output.
Therefore, once a Plugin invocation has started, a later model or lease failure terminalizes the run
with an explicit retry-suppression reason. Recovery never repeats that external call under the guise
of a model retry.

## Current UI meaning

The Knowledge surface renders the definition graph only. Each visible edge is labeled `DEPENDS ON` or
`USED BY`, carries the exact resource version, and names the manifest that declared it. People,
datasets, incidents, and semantic cross-system relationships remain explicit transfer gaps until the
four-stage pipeline and its operational models exist.

## Verification required before semantic activation

- reviewed extraction fixtures with schema failures recorded;
- a resolution corpus containing both false-merge and missed-merge cases;
- database constraints preventing unresolved candidates from appearing as canonical nodes or edges;
- provenance coverage of 100 percent for canonical edges;
- bounded traversal and edge-citation tests, including incomplete-graph answers; and
- transition tests proving plans are immutable and recovery cannot exceed its declared attempts.
