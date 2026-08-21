# Home v3 — Three Bands, One Filter

See `mockups/paul-os-home-v3.html`. Click a vertical chip and watch all three bands change together.

## Implemented L1 truth boundary

The mockup is interaction guidance, not runtime evidence. The implementation keeps its three-band
gesture and corrects these source claims:

- AIM coverage, certification, evidence age, milestones, and workstreams are `SYNTHETIC` while the
  checked-in program and any contributing source remain synthetic.
- `AWAITING TRANSFER` metrics render `—` and `NOT MEASURED`. They never display a stock current
  value, progress bar, trend, or operational verdict.
- Workstreams are now an explicit validated AIM collection with exact group, part, milestone,
  source, and timeline references. The UI does not own a second hardcoded row list.
- Attention decisions and operating exceptions remain global until a governed vertical edge exists.
- Every KPI opens a URL-backed L1 trace over its existing inputs, related workstream/action counts,
  and exact AIM, Operate, or Connections destination. The trace names the Objective binding as not
  declared; it does not invent a target or render a dead objective link before the L2 contract
  exists.
- Timeline and dated-list modes render the same validated workstream collection. The view choice is
  URL-backed and does not create a second program filter.
- Today reports scheduled work from the schedule endpoint, deduplicates exact schedule identities,
  and reconciles a quiet active day with returned paused schedules in Operate.
- Red remains reserved for an explicit safety stop. Coverage gaps use amber plus a written state.

Current browser-visible values are therefore six synthetic AIM rollups, two live briefing-ledger
readings, unmeasured transfer outcomes, and a synthetic declared program plan. Source failures stay
visible and never become zero or nominal.

## The structure

Three bands, in the order you actually ask questions:

| Band                             | Question            | Horizon        |
| -------------------------------- | ------------------- | -------------- |
| **01 · Are we on track**         | Where are we?       | State — now    |
| **02 · AIM manufacturing build** | Where are we going? | Plan — months  |
| **03 · What moves it**           | What do I do?       | Action — today |

**The thing that makes it one page instead of three widgets: a single vertical filter drives all three bands.** Pick Factory ops and the KPI tiles become that vertical's key results, the Gantt filters to its workstreams, and the task list scopes to its work. One control, three views, one mental model.

You already proved this pattern in AIM — group selection drives hardware and agents. This is the same state machine at program scale, which is why it's cheap to build.

## Band 01 — KPI board

**When "All" is selected**, one roll-up tile per vertical, so the board answers "which vertical is behind?" in one glance. Quality and Avionics read `0% · NO COVERAGE` — the two gaps AIM already reports, promoted to the front page where they're uncomfortable enough to fix.

**When a vertical is selected**, tiles become that vertical's key results. That _is_ the drill — no separate page needed for the first level.

### Every KPI declares its source

Three chips, and this is the transfer mechanism:

- **LIVE** — computed from data Paul OS already holds (runs, outcomes, costs, coverage)
- **SYNTHETIC** — real shape, seeded numbers
- **AWAITING TRANSFER** — the definition and the tile exist; the source binds on the work machine

The board looks complete today and is honest about which parts are real. On transfer you swap a source binding per KPI — **no UI changes, no new components.** That's the whole "engineer deeper into something I can transfer" answer: the transfer boundary is a per-metric source binding, not a rewrite.

### KPI ideas

**Buildable now from what the platform already records:**

| KPI                                  | Source that exists                            |
| ------------------------------------ | --------------------------------------------- |
| Agent coverage by vertical           | AIM already computes coverage gaps            |
| Decision latency (arrival → cleared) | Attention + resolutions                       |
| Zero-escalation rate                 | ExecutionRun vs AuthorityGrant                |
| Evidence freshness                   | AIM already shows evidence age per part       |
| Weekly spend by vertical             | Run cost records                              |
| Certified fleet ratio                | Catalog lifecycle states                      |
| Reuse rate                           | Builder decisions, once referred choices ship |

**Awaiting transfer — one per vertical, so each has a real outcome, not just platform hygiene:**

- Structures — as-built reconciled (serials with zero unpapered deltas)
- Propulsion — hot-fire triage time (test end → ranked hypotheses)
- Factory ops — print first-pass yield; suspect-lot trace time
- Integration & test — open items on the critical path
- Quality — MRB pack build time; repeat-defect detection
- Avionics — harness check time; sensor channel coverage

Pair them deliberately: **one platform KPI and one program KPI per vertical.** Platform KPIs prove the system works; program KPIs prove it mattered. A board of only platform metrics is a vanity board.

### Drill-through to OKRs

A tile opens the objective behind it: the objective, its key results with current-vs-target, **the agents assigned to it**, and the runs and outcomes that moved the number. That last part is the payoff — an OKR whose progress traces to specific agent runs with citations is a fundamentally different artifact from a number in a spreadsheet.

This needs one new governed resource kind:

```yaml
kind: objective
name: reduce-as-built-reconciliation-time
vertical: structures
owner: structures-engineering
period: 2026-Q4
keyResults:
  - id: kr_unpapered_deltas
    statement: 95% of serials close with zero unpapered deltas
    metric: structures.unpapered_delta_rate # → MetricDefinition
    target: 0.95
    source: awaiting_transfer
contributingAgents:
  - as-built-vs-as-designed@1.2.0 # → exact version pin
```

Objectives are Git manifests; samples stay in Postgres. Same split you already run, so it inherits versioning, promotion, and audit for free. `contributingAgents` uses the same exact-version pin as every other edge, so Knowledge's "agents that work on this entity" already knows how to render it.

## Band 02 — the Gantt

Rows are workstreams tagged by vertical; bars carry a state (complete / in work / planned / at risk) with a **text label on the bar**, not colour alone. Diamonds are milestones. One TODAY line.

**Your AIM seed already has the scaffolding** — it carries a `timeline` with `startAt`/`endAt` and markers, plus a `milestones` collection. So the Gantt isn't a new data model, it's a second renderer over the seed you already validate. Stock rows now, real program data on transfer, same component.

Clicking a bar should open that workstream's AIM part — the Gantt becomes the time axis of a map you already have.

## Band 03 — what moves it

**Main tasks only.** The rule that keeps it that way: a task earns the home page if it is due today, blocks a dated milestone, or is the only thing standing between a vertical and coverage. Everything else lives in Operate. Five is the target; the count is disclosed ("5 shown") so truncation is never silent.

Decisions stay a compact preview with the count, linking through to Attention. Home previews; Attention decides.

## Build order

**L0 · Layout and filter, stock data.** Three bands render, the vertical filter drives all of them, nothing is real. This is the mockup — it costs a day and it de-risks every decision below.

**L1 · Wire to what exists.** KPI tiles bound to real sources where they exist (coverage from AIM, latency from attention resolutions, escalation and spend from runs). Gantt reads the AIM seed's timeline and milestones. Tasks read schedules plus the attention queue. Every tile gets its LIVE / SYNTHETIC / AWAITING TRANSFER chip. **After L1 the page is honest, even though half of it is seeded.**

**L2 · Objectives.** Add the `objective` resource kind, the drill-through page, and `contributingAgents` edges. Now a KPI traces to an OKR traces to agents traces to runs.

**L3 · Source bindings.** Each metric declares how it will be computed post-transfer — plugin, capability, query shape — with no credentials. This is a manifest exercise, not code, and it's what makes the transfer a config change.

**L4 · Transfer.** Swap synthetic bindings for real connectors. Tiles flip from AWAITING TRANSFER to LIVE. Nothing in the UI changes, which is how you know the seam was in the right place.

## One warning

This page is now dense, and density fights the quiet-console rule you set. Keep the rule by state, not by count: **nominal KPI tiles stay dim; only at-risk and no-coverage tiles carry colour and a state label.** In the mockup, four of eight tiles are visually loud because four are genuinely off-track. If a day comes when everything is on track and the whole board goes quiet, that is correct behaviour, not a bug.
