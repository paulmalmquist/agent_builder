# Operational Agent Proving Catalog

Status: accepted follow-on validation scope after Phase 2. This document defines intended proving
work; manifests, tests, release evidence, and installed connections remain the source of
implementation truth.

## Purpose

Paul OS will prove the platform with substantial agents that produce operational work products.
The catalog deliberately excludes email drafting, generic summarization, and other low-consequence
assistants. It targets data operations and synthetic aerospace manufacturing, where correctness,
provenance, bounded authority, and failure behavior can be measured.

The program contains exactly 16 agent candidates across five authority rungs. Each rung proves a
larger part of the platform. An agent may advance only after the preceding authority model is green;
the final enterprise resource planning write agent is the exam, not the lesson.

Tracked content stays organization-neutral and synthetic. Private deployment overlays may supply
real program names, system names, schemas, part identifiers, dates, owners, and connection details.

## Authority ladder

| Rung | Authority ceiling                            | Platform behavior under test                                                                         |
| ---- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| R0   | Read one governed source                     | Manifest through outcome, exact citations, bounded cost, machine-checkable truth                     |
| R1   | Reconcile several read-only sources          | Context precedence, lineage, ranked hypotheses, ownership, and source conflict                       |
| R2   | Produce decision-grade analysis              | Coverage disclosure, confidence, refusal on insufficient evidence, and review quality                |
| R3   | Draft an effectful work product              | Run-specific approval, scope escalation, human edits, and no premature writes                        |
| R4   | Write one exact system-of-record transaction | Target-native idempotency, ambiguous-result reconciliation, bounded cancellation, and complete audit |

The distribution is intentionally `3 / 3 / 6 / 3 / 1`. The middle rung is larger because
manufacturing decisions provide the strongest test of evidence completeness without granting write
authority.

## Candidate catalog

| #   | Agent candidate                                      | Rung | Required work product                                                                                                     | Initial proving mode                                                         |
| --- | ---------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Warehouse Cost Sentinel                              | R0   | Attribute a spend anomaly to an exact job, principal, and technical cause; name a bounded remediation                     | Governed warehouse read connection plus replay corpus                        |
| 2   | Schema Change Blast-Radius Analyst                   | R0   | Rank downstream tables, views, scheduled jobs, and dashboards affected by one proposed change                             | Governed warehouse metadata and job history                                  |
| 3   | Freshness and Silent-Failure Watch                   | R0   | Detect a stale, empty, or partial partition even when the pipeline reports success                                        | Governed warehouse metadata and historical baselines                         |
| 4   | Pipeline Incident First-Responder                    | R1   | Rank probable causes and the owning team from logs, freshness, schema change, source-control change, and prior incidents  | Warehouse plus DevOps and source-control read connections                    |
| 5   | Metric Reconciliation Analyst                        | R1   | Trace two conflicting reports to the exact filter, grain, lineage, or late-data divergence                                | Warehouse lineage plus synthetic report definitions                          |
| 6   | Orphan and Cost-of-Ownership Reviewer                | R1   | Propose a cited deprecation list with non-use evidence, downstream impact, and carrying cost                              | Warehouse, business-intelligence usage, and pipeline metadata                |
| 7   | Launch-Readiness Open-Item Burndown                  | R2   | Map open quality, material, work-order, and schedule constraints to the critical path and show the delta                  | Synthetic quality, planning, and enterprise resource planning fixtures first |
| 8   | As-Built versus As-Designed Reconciler               | R2   | Compare one serialized build with the released configuration and cite authorization for every delta                       | Synthetic product-lifecycle and build-record fixtures first                  |
| 9   | Feedstock and Print-Lot Genealogy                    | R2   | Trace a suspect material lot or qualified process parameter set to every affected part, assembly, and build location      | Synthetic additive-manufacturing genealogy fixture first                     |
| 10  | Print Parameter Drift Sentinel                       | R2   | Detect qualified-process drift before an out-of-spec result and correlate it with later findings                          | Synthetic machine telemetry and quality findings first                       |
| 11  | Hot-Fire Quicklook Analyst                           | R2   | Compare high-volume test channels with like configurations and rank off-nominal hypotheses with citations                 | Synthetic historian corpus first                                             |
| 12  | Recurrence and Escape Analyst                        | R2   | Find individually dispositioned defects that form a cross-serial or time-based recurrence                                 | Synthetic quality-record corpus first                                        |
| 13  | Material Review Evidence Package Builder             | R3   | Assemble cited design, as-built, precedent, cost, and schedule evidence; draft a disposition for human decision           | Synthetic fixtures and approval simulation only                              |
| 14  | Work Intake Router                                   | R3   | Find duplicates, infer ownership from real dependency evidence, and produce a validated proposed create or update payload | DevOps read connection; Paul OS approves the draft but does not send it      |
| 15  | Supplier Delay Impact and Escalation Builder         | R3   | Resolve a commitment slip through part genealogy to affected builds and draft an evidence-backed escalation               | Synthetic supplier, genealogy, and schedule fixtures first                   |
| 16  | Enterprise Resource Planning Scrap Transaction Agent | R4   | Post one approved scrap transaction from an already approved nonconformance disposition                                   | Sandbox system only until every prior rung is certified                      |

## Required catalog record

Every candidate must be specified before a Builder draft is created. These fields define a new
catalog contract to implement; they are not all fields in the current resource schemas:

- stable catalog ID, rung, objective, intended users, and measurable work product;
- exact Plugin family, version, tool, residency, classification, and source requirements; imported
  releases, grants, and runs additionally bind the resolved digest and installation;
- maximum effect (`read`, `write`, or `destructive`) and whether every run requires approval;
- validation mode: `live_read_only`, `replay_corpus`, `synthetic_fixture`,
  `approval_simulation`, `sandbox_write`, or `blocked_on_connector`;
- input and output schemas, mandatory citations, coverage disclosure, and refusal conditions;
- acceptance outcome, cost and latency ceilings, and promotion prerequisites;
- target-native idempotency support, ambiguous-result reconciliation, compensating evidence, or an
  explicit irreversibility declaration for any candidate that can write.

A missing live connection is represented as `blocked_on_connector`. A live connection failure never
falls back silently to a fixture. Fixture runs and live runs produce visibly different evidence.

## First proving sequence

### 1. Warehouse Cost Sentinel

Build this vertical slice first. It has arithmetic ground truth, a direct cost outcome, and no domain
judgment. A live Google Cloud BigQuery run is allowed only after the installed connection exposes an
exact read-only dataset allowlist, job-history access, a bytes-billed ceiling, dry-run support, and
secret references rather than values. Continuous integration uses a sanitized replay corpus.

Promotion targets include anomaly attribution precision, false-positive rate, citation coverage,
query-cost compliance, schema conformance, and zero attempted writes. Query principals may appear
as incident evidence but must never become individual productivity rankings.

The current warehouse connector cannot query arbitrary SQL or warehouse job metadata. This slice
therefore requires either an approved monitoring view addressable through a bounded descriptor and
an executable bounded database or HTTP Plugin tool, or a new bounded BigQuery metadata Plugin
adapter or approved HTTP bridge. It must never accept model-generated SQL.

### 2. Pipeline Incident First-Responder

Build this second as the DevOps proving case. It replaces manual incident triage, not the governed
work-item ledger. The first release reads pipeline results, logs, source-control changes, warehouse
freshness, and known incident outcomes. It must rank hypotheses with evidence and identify the
probable owning team. It must not create, assign, close, or reprioritize a work item.

Grade it against historical incidents with known root causes: time to first correct hypothesis,
root-cause recall, top-three precision, owner accuracy, citation coverage, and unsupported-claim
rate. Candidate 14 may draft a proposed work-item payload for Paul OS approval, but this catalog does
not authorize it to send that payload to the external DevOps system.

### 3. Launch-Readiness Open-Item Burndown

Build this third with synthetic quality, planning, and enterprise resource planning fixtures. It is
the first decision-grade manufacturing test. It must disclose every unavailable source and refuse
to claim completeness below a declared coverage threshold. Quiet omission is a gate failure.

After these three are green, implement candidate 9 as the distinctive additive-manufacturing proof,
candidate 13 as the first approval-gated draft, and candidate 16 as the final sandbox write exam.

## Evaluation and promotion gates

| Rung | Mandatory evidence                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| R0   | Exact arithmetic or record agreement, citation coverage, bounded bytes and cost, schema conformance, zero attempted writes            |
| R1   | Source reconciliation, known-cause recall, ranked-hypothesis precision, owner accuracy, conflict disclosure, zero attempted writes    |
| R2   | Coverage and genealogy completeness, false-positive rate, insufficient-evidence refusal, reviewer agreement, override capture         |
| R3   | Schema-valid draft rate, critical-omission rate, reviewer-adjudicated correctness, structured revision reasons, zero external writes  |
| R4   | Exact run approval, narrowed authority, target-native idempotency where available, no blind replay, reconciliation and audit evidence |

Every suite includes adversarial cases for missing sources, stale evidence, conflicting records,
over-broad scopes, malformed identifiers, excessive cost, duplicate requests, and attempted action
outside the declared rung.

Current resource evaluation is limited to Skill subjects and a Daily-Brief-specific assertion
vocabulary. Legacy certification is `manifest_fixture` evidence against one workspace and
department corpus, not an Agent-specific or rung-specific semantic evaluation. Meaningful promotion
of any candidate therefore requires generic Agent-subject evaluation, rung-specific assertion
schemas, and per-agent and per-suite corpus selection. Other numerical targets in this addendum also
require a governed Metric Definition and executor support. Until those prerequisites exist, every
listed gate is an acceptance target, not claimed certification evidence.

## Current feasibility boundary

No candidate in this catalog is a canonical Agent resource yet. Minimal placeholders could compile,
but would be misleading and neither runnable nor meaningfully certifiable. A truthful candidate
needs exact pins for every capability it actually uses, a complete executable dependency closure,
and a matching Evaluation Suite in its release.

The current Plugin worker executes HTTP transports only. Database, command-line, and Model Context
Protocol manifests validate but fail closed at execution. Candidate 1 therefore remains
`blocked_on_connector` until Paul OS has an approved governed monitoring view, a bounded descriptor,
and an executable bounded database or HTTP Plugin tool; alternatively, it needs a bounded BigQuery
metadata Plugin adapter or approved HTTP bridge. The older provider-shaped warehouse connector does
not satisfy the Phase 2 Plugin execution contract and cannot query warehouse job metadata.
Candidates 2 and 3 additionally need governed lineage and freshness views; candidate 2 needs
approved business-intelligence metadata to claim dashboard impact.

A private DevOps HTTP Plugin is also insufficient by itself: the current execution service rejects
non-Daily-Brief entrypoints. Candidate 4 and every other candidate require a generic bounded
non-Daily-Brief executor and output-contract dispatcher, in addition to exact hosts, project scope,
tools, effects, and secret slots.

Local command-line tools or cached identities do not authorize a connection. Connection discovery
and a read-only health probe are separate implementation checkpoints, and their private output must
not enter Git, logs, or evaluation fixtures.

## Connection plan

| Connection                           | Candidates               | Scope rule                                                                                                         |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Google Cloud BigQuery                | 1–6                      | Read-only first; exact project and dataset allowlist; maximum bytes billed; no raw payload logging                 |
| DevOps work-item and pipeline system | 4 and 14                 | Read pipeline and incident history; emit a proposed payload only; external create/update is a future R4 capability |
| Source control                       | 4 and 14                 | Read exact repositories and commits; no branch, pull-request, or policy mutation                                   |
| Quality system                       | 7, 8, 10, 12, 13, and 16 | Manifest and synthetic fixture now; live use remains unavailable until an owner approves a connector               |
| Enterprise resource planning         | 7, 8, 9, 13, 15, and 16  | Read-only validation before any sandbox write; production write is out of this scope                               |
| Product lifecycle and configuration  | 8, 9, 13, and 15         | Exact read subsets with classification-aware visibility                                                            |
| Test historian                       | 10 and 11                | Bounded time-series reads; no test control or actuator capability                                                  |

Connection availability must be checked during implementation. The presence of a local command-line
tool or credential does not itself authorize Paul OS to use that connection.

## Repository projection

Implementation will land in independently green slices:

- `06-business-domains/synthetic-aerospace-manufacturing` for vocabulary, mandatory policy, and a
  read-first Plugin pack;
- `05-reference/manufacturing-authority-ladder` for the immutable rung definitions and promotion
  expectations;
- `03-projects/synthetic-manufacturing-validation` for exact pins and project overlays;
- `12-agents` and `02-skills` for versioned candidate definitions;
- `09-evaluations` for rung-specific corpora and gates;
- `10-metrics` for outcome quality, time saved, cost, and zero-unauthorized-action measures;
- private ignored overlays for real organization, connection, program, system, and data details.

Before the first runnable slice, Paul OS needs the bounded connection described above, the generic
non-Daily-Brief executor and output-contract dispatcher, Agent-subject and rung-specific evaluation,
and a sanitized replay corpus. The slice must then complete manifest validation, immutable release
creation, evaluation, promotion, referred-choice indexing, an exact authority grant, execution,
outcome evidence, and reuse from Builder intake. The root README should describe the catalog only
after that slice exists.

For the sole R4 capstone, target-native idempotency is used where available. Otherwise Paul OS makes
at most one automatic attempt, never blindly replays an ambiguous result, and requires reconciliation
before any retry. A kill switch blocks new calls and cooperatively cancels active calls; it cannot
promise to reverse a transaction already committed by an external system. Evidence must record a
compensating action or explicitly state irreversibility.

## Explicit non-goals

- No email-writing, meeting-summary, or generic chat agents.
- No individual productivity scorecards or rankings.
- No authentic program, part, supplier, employee, table, endpoint, or credential data in Git.
- No production enterprise resource planning or quality-system writes in this scope.
- No silent fixture substitution after a live connection fails.
- No promotion based only on deterministic fixture agreement when semantic quality is required.
