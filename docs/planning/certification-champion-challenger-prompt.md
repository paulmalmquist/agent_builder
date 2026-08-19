# Coding Prompt — Certification (Champion/Challenger), Agent Library + Search, Single-Shot Mode

## Role and mode

You are a senior platform engineer working in the agent-builder monorepo (Express 5 + Prisma 6 + Postgres, Zod-first contracts in `packages/contracts`, React 19 + TanStack Query frontend, deterministic generator CLI). This work runs in **two phases with a hard gate between them**:

- **Phase A — PLAN.** Produce the design artifacts listed below. Write no implementation code. Stop and present the plan for human review.
- **Phase B — BUILD.** Only after explicit approval of Phase A. Implement in the build order given, keeping every commit green.

## Repo facts (verified — do not rediscover)

- Contracts: `packages/contracts/src/{schemas,state-machines,routes,openapi}.ts`. Agent transitions today: `draft→generating→ready→shadow→active`, `failed→draft`, and **`active: []` is terminal — there is no versioning, demotion, or retirement**.
- One spec per agent (`AgentSpec.agentId @unique`, `revision Int`). Manifest is a Json column on Agent. `EvaluationTest` rows are fixture results created by shadow-deploy.
- Audit/actor infra EXISTS: `src/audit.ts` (`appendAuditEvent`), `src/request-context.ts` (`currentActorId`), `updatedBy` columns. Use it for every new lifecycle change.
- Routes live under `/agents/*` (nginx proxies `/agents`, `/health`, `/openapi.json`). Existing: specs CRUD by section, `specs/:specId/generate`, `generation-jobs/:jobId`, `:agentId/{recover,shadow-deploy,evaluation}`, catalog `GET /agents?query=`, `POST /agents/similarity`, `GET /agents/sources`.
- Generation: `GenerationDispatcher` + `Semaphore` + `CliGeneratorRunner` (spawn, JSONL progress, orphan reaping on boot). Manifest gates already exist in `manifestEvaluationSchema` (factual_accuracy, citation_coverage, unauthorized_actions).
- Frontend: single-view `App.tsx`, no router. Components: `SuggestionsPanel`, `CandidateDialog`, `WorkflowStep`, `GenerationPanel`, `ReviewDialog`, spec forms. MSW + Vitest.
- Governing rules (non-negotiable, from the platform charter): the builder never silently modifies production agents; promotion requires human approval; departments define workflows, not "an AI agent"; every run carries identity and lineage.

---

# Part 1 — Certification protocol (champion/challenger)

## Concept

A **champion** is the certified, promoted version of an agent serving its department. A **challenger** is any newer generated version of the same agent family. Challengers earn promotion only by passing a **certification run**: the full eval corpus plus a paired comparison against the champion on identical inputs. Promotion is a human decision recorded with evidence. Nothing auto-promotes. Champions are re-certified on a schedule to detect drift.

## Phase A design deliverables

1. **ADR: version modeling.** Decide between (a) `AgentVersion` child table under Agent with a `championVersionId` pointer, or (b) sibling Agent rows grouped by `familyId`. Evaluate against: existing 1:1 spec↔agent constraint, catalog search, audit lineage, migration cost. Recommend one; justify.
2. **State machine extension** (in `state-machines.ts`, with exhaustive transition tests):
   - Agent/version: add `certifying`, `certified`, `rejected`, `retired`. Proposed: `shadow→certifying→certified|rejected`, `certified→active` (promotion, approval-gated), `active→retired` (only when a successor is promoted or explicit retirement), `rejected→draft`.
   - CertificationRun: `queued→running→passed|failed|error`, all terminal states final.
3. **Data model:** `CertificationRun` (agentVersionId, championVersionId nullable for first-ever, corpusVersion, generatorVersion, gate config snapshot, per-gate scores, verdict, startedBy, timestamps), `EvalCase` (corpus membership, input payload, expected output/citations, tags: golden|replay|false_alarm|regression, source: seed|override|incident, active flag), `EvalCaseResult` (runId, caseId, actual, score breakdown, passed), `PromotionDecision` (runId, decidedBy, decision, rationale, audit-linked). Corpus is **versioned**: runs reference an immutable corpus version.
4. **Sequence diagrams:** challenger certification; champion nightly re-cert; promotion swap (transactional: challenger→active + champion→retired in one transaction with audit events); failure/override → new EvalCase.

## Functions (service layer — mirror existing service/DI pattern in `create-services.ts`)

- `CertificationService`: `createRun(versionId)` (409 if one active per version — partial unique index like generation jobs), `executeRun` (dispatcher + semaphore, reuse the generation dispatcher pattern including boot-time reaping), `scoreCase`, `evaluateGates` (pure, config-driven: `factual_accuracy ≥ 0.98`, `citation_coverage = 1.00`, `unauthorized_actions = 0`, `champion_regression ≤ 0` on paired cases — thresholds in DB-backed gate config, seeded, not hardcoded).
- `ComparisonService`: run champion and challenger manifests against identical case inputs (deterministic manifest interpreter now; LLM executor later behind the same interface), produce paired diffs.
- `PromotionService`: `promote(versionId, runId, rationale)` — validates run passed + fresh (staleness window), requires actor, swaps champion pointer transactionally, appends audit events, never callable without a passing run.
- `CorpusService`: `addCaseFromOverride`, `addCaseFromIncident`, `deactivateCase`, `publishCorpusVersion` (immutable snapshot). Every human override of agent output becomes a candidate eval case — this is the self-improving loop.

## Eval loops

1. **On-demand:** challenger certification triggered from UI after shadow deploy.
2. **Scheduled:** nightly champion re-cert against latest corpus (cron-style scheduler in-process is fine for now; document the cutover to a real scheduler). Drift → champion flagged `degraded` (non-blocking status field, not a state transition) + surfaced on the page.
3. **Feedback:** override/incident → corpus candidate → human curation → next corpus version. Track per-corpus-version pass-rate history so gates can be tightened deliberately.

## Endpoints (contracts-first: Zod schemas + OpenAPI regenerated)

- `POST /agents/:agentId/certification-runs` → 202 + run status URL
- `GET  /agents/certification-runs/:runId` (scores, per-case results, gate verdicts)
- `GET  /agents/:agentId/certification-runs` (history)
- `POST /agents/:agentId/promote` (body: runId, rationale)
- `GET/POST /agents/eval-cases`, `POST /agents/eval-corpus/publish` (governed, actor-attributed)

## Certification page (frontend)

Route `/certification/:agentId` (see routing decision in Part 2). Layout: champion vs challenger side-by-side header cards (version, manifest hash, corpus version); **gate scoreboard** (each gate: threshold, champion score, challenger score, pass/fail lamp — reuse the instrument aesthetic, no dashboards-with-donuts); run history strip; paired-case diff viewer (input, champion output, challenger output, citation diff); **Promote** button enabled only on a passing, fresh run — clicking opens a rationale dialog; rationale required. Failed gates render the failing cases first. Everything reads from the run resource; no client-side score math.

---

# Part 2 — Agent Library page + top-middle search

## Library

- Route `/library`: full catalog view — grid of governed agents (name, department, status/champion badge, capability tags), filters (department, status, provider), detail drawer reusing `CandidateDialog` semantics with use-as-is / configure / extend actions that deep-link back into the builder flow with the candidate preselected.
- **Routing decision (Phase A):** the app has no router. Recommend `react-router-dom` (the single allowed new frontend dependency) over hand-rolled hash routing; justify in the ADR. Routes: `/` (builder), `/library`, `/certification/:agentId`.

## Search (top middle, interactive)

- New slim top bar: brand mark left, **search affordance dead-center**, `BROWSE AGENT LIBRARY →` link right (to `/library`).
- Behavior: a circled search icon (business-card visual language); on click or `Ctrl/Cmd+K` it expands (~240→420px, 200ms, `--ease-precision`) into an input with debounced (250ms) typeahead against existing `GET /agents?query=`; dropdown results with keyboard navigation (↑↓ Enter Esc), highlighting matched text; Enter on a result opens the agent detail; Esc collapses. Full a11y: `role="combobox"`/`aria-expanded`/`aria-activedescendant`, focus trap none (it's inline), focus returns to icon on collapse.
- Reuse the catalog query hook; no new endpoint.

---

# Part 3 — Single-shot vs guided toggle

## Behavior

Segmented toggle in the workflow column header: `GUIDED | SINGLE-SHOT`.

- **Guided** = existing four-step flow, unchanged.
- **Single-shot** = one prompt ("Describe the agent: what it does, what it reads, what it's allowed to do, and how you'll know it worked") → `POST /agents/specs/interpret` → returns a **prefilled draft of the same four sections** with per-section `confidence: high|medium|low` and `unresolved: string[]`.

## The invariant (non-negotiable)

Single-shot is an _input method_, not a _bypass_. It prefills the identical `AgentSpec` contract; section validation, completion gating, Review & Generate, generation, shadow, and certification are untouched. A single vague prompt can never yield a deployable agent without the four sections becoming concrete — this enforces the platform rule that departments define workflows, not "an AI agent."

## Interpreter (backend)

- `POST /agents/specs/interpret` — deterministic heuristic extractor now (keyword/pattern mapping to seeded source descriptors and guardrail types), designed as an adapter interface so an LLM implementation slots in later behind the same request/response contract. Response never invents source descriptors: it may only reference registry entries; unmatched references return as `unresolved`.

## Contingencies (design for every one; test every one)

1. **Low confidence:** sections at `medium|low` confidence are prefilled but marked `needs-review`; user must open and explicitly save each before it counts toward completion. Auto-confirm is forbidden.
2. **Unknown sources:** interpreter finds "our ERP" with no registry match → placeholder chip flagged unresolved; blocks knowledge-section completion until mapped to a governed descriptor.
3. **Mode switching mid-flow:** single-shot→guided keeps prefilled values (they're just spec sections). Guided→single-shot with confirmed sections present → warn; interpretation may only fill empty/unconfirmed sections, never overwrite confirmed ones.
4. **Interpreter unavailable** (future LLM down / timeout): fail closed — explicit `DEPENDENCY_UNAVAILABLE` notice and a one-click switch to guided. Never a silent empty prefill.
5. **Authority escalation in prompt** ("give it write access to production holds"): interpreter output is validated against guardrail allowlists; any action beyond read-only defaults lands in guardrails as `approval_required` and flags the section `needs-review`. Prompt text can request authority; only the confirmed guardrails step grants it.
6. **Multi-agent prompt:** if the prompt describes ≥2 distinct trigger/outcome pairs, return a `split` suggestion listing candidate decompositions; user picks one scope per spec. No mega-agents.
7. **Lineage:** persist the original prompt, the full interpretation, per-section confidence, and each user confirmation on the spec (audit-linked) — certification and incident review can trace every deployed behavior to its origin.
8. **Reuse-first still applies:** single-shot runs the same catalog search + similarity step on the interpreted outcomes before offering "build new."

---

# Constraints (both parts)

- Contracts-first: every schema/endpoint lands in `packages/contracts` with regenerated OpenAPI; snapshot test updated.
- Prisma migration + idempotent seed extension: seed one champion with run history, one challenger with a passing and a failing run, ≥12 eval cases across golden/replay/false_alarm.
- Every lifecycle change appends an audit event with actor; promotion decisions immutable.
- State-machine tests enumerate the full transition table including all invalid transitions.
- No new backend dependencies; frontend may add only `react-router-dom`.
- Coverage gate holds; lint/format/typecheck/build green; `docker compose config` valid.

# Phase A output (present for review before any code)

1. ADR: version modeling choice (+ routing choice) with rejected alternatives.
2. Final state-machine diagram + transition table.
3. Prisma schema diff (prose or draft schema, not a migration).
4. Endpoint contract sketches (Zod, request/response).
5. Certification page wireframe description.
6. Risk list: top 5 ways this design fails at work-scale (e.g., corpus staleness, paired-comparison cost, promotion race), each with mitigation.
7. Build order for Phase B with test-first checkpoints.

# Phase B acceptance checklist

- Challenger cannot reach `active` without a passing, fresh, human-approved run — proven by tests attempting every bypass path (direct status update, stale run, failed run, missing rationale, concurrent double-promote).
- Promotion swap is atomic: crash injection between demote/promote in the transaction leaves no dual-champion or no-champion state.
- Nightly re-cert flags a seeded drift case as `degraded` without any state transition.
- Single-shot with the seeded "supplier delay" prompt prefills all four sections referencing only registry descriptors; a prompt requesting write authority yields `approval_required` + `needs-review`.
- Search: Ctrl+K expands, typeahead hits catalog endpoint ≤1 request per 250ms, keyboard-only operation works, screen reader announces result count.
- `npm run typecheck && npm test && npm run build` green; coverage ≥ existing gate.
