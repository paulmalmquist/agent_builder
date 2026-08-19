# Paul OS — Independent Acceptance Review

**Target:** http://localhost:8080 · **Date:** 2026-08-18 · **Viewport:** ~1440×1000, Chrome, fresh tab
**Scope:** deployed product only. No repository, source, database, or container inspection. No data modified. No approve/reject/promote/install/revoke action submitted.

---

## 1. Verdict

# READY WITH FIXES

The product is no longer a marketing shell — it is an operating surface, and its honesty discipline is unusually strong. Home refuses to invent meetings, refuses to draw a chart it cannot source, and labels every bounded count. Attention states consequence _and_ undo on every action. Knowledge correctly renders relationship direction and declares the manifest as provenance rather than an endpoint. AIM ships all six required groups and admits its two coverage gaps in plain text.

It is not ready to hand to an evaluator as-is. One core route (`/evidence`) opens with a red dependency error under normal conditions, which the acceptance criteria prohibit outright. Beyond that, three surfaces present raw identifiers as primary user-facing names, duplicate items are not grouped anywhere they occur, and fixture/test entities are visible in both search and the knowledge index. None of these are architectural — they are copy, de-duplication, and identifier-presentation defects.

---

## 2. Findings

### P0

**P0-1 · Red dependency error on `/evidence` under normal conditions**

- **URL:** http://localhost:8080/evidence
- **Steps:** Load the route. No interaction.
- **Expected:** No red dependency alert under normal conditions.
- **Actual:** A red banner reads _"Production authority unavailable. Production channel was not found"_, directly beneath the count row. Below it the page still renders a "Production authority" card and a "No release evaluation selected" empty state — an error and a nominal empty state on the same screen.
- **Evidence:** Screenshot `evidence-red-alert`. Network shows no 4xx/5xx; the alert is application state, not transport failure.
- **Why it matters:** This is the first thing an evaluator sees on a core route, and it is indistinguishable from a broken build.

### P1

**P1-1 · Attention does not group identical decisions**

- **URL:** http://localhost:8080/attention
- **Steps:** Load, scroll the DECIDE list.
- **Expected:** Equivalent requests grouped, with an exact request count.
- **Actual:** _"Review measured daily-brief evidence"_ appears as **three separate, byte-identical cards** (same subject, same body, same SKILL DAILY BRIEF 1.0.0, same two actions). No count, no grouping. Queue reads 5 decisions, of which 3 are the same decision.
- **Evidence:** Screenshots `attention-dupe-1`, `attention-dupe-2`.

**P1-2 · Raw identifiers used as primary names on `/operate`**

- **URL:** http://localhost:8080/operate
- **Steps:** Load the route, read the Execution ledger and Authority envelopes columns.
- **Expected:** No raw identifiers presented as primary user-facing names.
- **Actual:** Card titles are `Run 25151e4e`, `Run ade64896`, `Grant 3a6d2452`, `Grant f8d3ec2c`. Card bodies expose release digests: `RELEASE · 6674482e3367bbae…`, `74d7b0fa96ed075c…`. Nothing names the agent, skill, or purpose.
- **Evidence:** Screenshot `operate-raw-ids`.

**P1-3 · Raw identifiers in `/incubator` card bodies**

- **URL:** http://localhost:8080/incubator
- **Actual:** Observation cards print `SIGNAL · compose-outcome-signal-97294945-836b-4cc2-8698-dbb1eb9cdc8e`, `RUN · F87FCF42`, `OUTCOME · 88847990`; candidate cards print `OBSERVATION · 3CF0CC49`; staged memory prints `SOURCE RUN · F87FCF42`.
- **Evidence:** Screenshot `incubator-ids`.

**P1-4 · Fixture and duplicate entities visible in Knowledge**

- **URL:** http://localhost:8080/knowledge?type=agents
- **Steps:** Open Knowledge → Agents & Skills → read the entity index.
- **Expected:** A user-facing index of governed definitions.
- **Actual:** `daily-brief` appears **five or more times** as Skill; `Scoped legacy mirror` appears twice. Three entries describe themselves as _"Produce a synthetic, governed briefing for worker integration tests."_ — test fixtures presented as product content. **No version is shown in the list**, so the duplicates are indistinguishable until selected.
- **Evidence:** Screenshot `knowledge-dupes`.

**P1-5 · Search returns a fixture identity marked CERTIFIED**

- **URL:** http://localhost:8080/ (⌘K field)
- **Steps:** Focus the search field, type `test`.
- **Actual:** Result: **"Compatibility test agent"** under `LEGACY AGENT CATALOG · 1`, badged **CERTIFIED**, owner "Synthetic Operations".
- **Evidence:** Screenshot `search-fixture`.

**P1-6 · `/build` has no page H1 and retains marketing copy and stock icons**

- **URL:** http://localhost:8080/build
- **Expected:** Exactly one clear H1; no marketing landing copy.
- **Actual:** The page opens with _"Build or extend the right agent. Faster. Governed. Effective."_ — sales tagline copy, not a page title. There is no "Build" H1. The step cards use the generic icon set removed elsewhere: a **crosshair**, a **database cylinder**, and **code brackets**.
- **Evidence:** Screenshot `build-no-h1`.
- **Note:** Sequential disclosure works correctly here — steps 02/03 show `LOCKED · COMPLETE STEP 01 FIRST`.

**P1-7 · `/connections` count contradicts its own content**

- **URL:** http://localhost:8080/connections
- **Actual:** `INSTALLED SHOWN 0 · HEALTHY SHOWN 0 · DEGRADED SHOWN 0 · MISSING SECRET REFS SHOWN 0`, yet a connector card renders below with status **UNKNOWN** and a prominent primary **INSTALL PLUGIN** button. A footnote states _"Only HTTP tools execute in this checkpoint. MCP, CLI, database, and workstation transports remain visible but unavailable until their governed runtime exists"_ — i.e. some visible connectors can only fail.
- **Not tested:** INSTALL PLUGIN was not clicked (safety rule), so whether the action succeeds is unverified.
- **Evidence:** Screenshot `connections-zero`.

**P1-8 · Today's timeline is 12 identical, self-contradicting events**

- **URL:** http://localhost:8080/
- **Actual:** The time axis renders ~12 consecutive entries, all `7:50 AM`, all titled **"Daily Brief run finished"**, each sub-labelled **"cancelled · terminal outcome recorded"**. A cancelled run did not finish. They are not grouped, and they crowd out every other event before the NOW marker.
- **Evidence:** Screenshot `today-dupes`.
- **Passes:** the agent _is_ named (never bare "Agent run"), and the NOW marker exists at 8:38 AM.

### P2

**P2-1 · Attention detail dialog leaks an internal model name and has an incoherent flight recorder**

- **URL:** /attention → card 01 → "Why am I seeing this?"
- **Actual:** `SOURCE: MemoryCandidate` — an internal class name in a user-facing field. The flight recorder lists **`model-execution` twice**, with _"Run phase model-execution is succeeded"_ appearing **before** _"The worker claimed the run and started model execution"_ — reverse order and ungrammatical. The dialog promises _"Review each phase, its duration, and its recorded cost"_, but **3 of 4 phases show `–` for both**.
- **Evidence:** Screenshot `attention-detail`.

**P2-2 · Improvement cards substitute the item's own title into its sentence**

- **Actual:** _"A repeated signal suggests a change to **Review the synthetic repeated behavior**; no change exists until a human moves it to the Incubator."_ The subject slot should hold the governed subject (e.g. "Daily Brief"), not the card's own headline.

**P2-3 · Settings identifies workspace and department only by UUID**

- **Actual:** `WORKSPACE ID 00000000-0000-4000-8000-000000000001`, `DEPARTMENT ID …0002`, `PRINCIPAL ID …0003`. No human-readable workspace or department name anywhere on the page.
- **Passes:** everything else on Settings is exemplary — see §6.

**P2-4 · Knowledge URL exposes a raw entity UUID** — `?entity=fabf2f8d-9542-4f28-8cc7-ab5eedc85a8d`. Not displayed as a name, so borderline, but it is the shareable address of the page.

**P2-5 · Placeholder values rendered as data on `/operate`** — `COST · – / $0.1000 ceiling` and `FLIGHT RECORDER 10% –`. Also `Run 25151e4e` shows `FAILED` with the reason _"Execution failed"_, which states nothing.

**P2-6 · Grammar** — `/connections`: _"1 typed capabilities are ready to install."_

**P2-7 · AIM 3D scene is not legible as a vehicle** — the WebGL view renders as scattered blocks and pyramids with no in-scene labels; a reader cannot identify a part without the adjacent list. Selection _does_ drive the scene (verified: selecting Stage 1 oxidizer tank changed the highlighted geometry), so the linkage works — the readability does not.

**P2-8 · Console warnings** — 7× `No 'HydrateFallback' element provided to render during initial hydration` (React Router), emitted on each navigation. No console errors observed anywhere.

**P2-9 · Renderer froze once** — after a 10-tick scroll on `/`, `Page.captureScreenshot` timed out at 30 s and the tab was briefly unresponsive. It recovered without reload and did not recur at 6–8 ticks. Possible scroll/animation cost on the long timeline; worth profiling.

---

## 3. Route-by-route

| Route          | Verdict          | Notes                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/` Today      | **Pass with P1** | Operating surface, correct date, NOW marker at 8:38, honest "Not connected on this machine", "Nearest 12 of 126 ledger events", refuses to draw the chart ("History contract needed"). Fails on P1-8 duplicate contradictory events.                                                                                                                                     |
| `/attention`   | **Pass with P1** | Loads promptly, 5 decisions / 0 degraded, consequence+undo on every action, no UUIDs on card faces. Fails on P1-1 grouping, P2-1 dialog.                                                                                                                                                                                                                                 |
| `/aim`         | **Pass**         | All six groups present; Quality (1 part) and Avionics and safety (4 parts) both read `NO CURRENT CERTIFIED AGENT`; `PRIMARY GROUPS 6 / COVERAGE GAPS 2`; PRINTED / PURCHASED / FACILITY all present with real process sentences; R0–R4 rungs, certification state, connector marks with READ/WRITE **in text**; disclaimers visible. P2-7 only.                          |
| `/knowledge`   | **Pass with P1** | Correctly self-describes as a typed definition graph / transfer boundary; partial index disclosed (100 of 127); `USED BY` / `DEPENDS ON` directions correct; declaring manifest rendered as provenance ("Declared by X V1.1.0"), not as an endpoint; exact versions on both ends; "No semantic relationship is inferred" on every edge; counts say SHOWN. Fails on P1-4. |
| `/build`       | **Fail**         | P1-6: no H1, marketing copy, stock icons.                                                                                                                                                                                                                                                                                                                                |
| `/catalog`     | **Pass**         | H1 present, all counts say SHOWN, honest empty state. Minor: `CERTIFIED SHOWN 0` sits oddly beside AIM's certified agents and Knowledge's `LIFECYCLE certified` — different scopes, but a reader may read it as a contradiction.                                                                                                                                         |
| `/operate`     | **Fail**         | P1-2 raw identifiers; P2-5 placeholders. Runs, authority and schedules are all exposed read-only as required; no mutation was performed or implied.                                                                                                                                                                                                                      |
| `/connections` | **Fail**         | P1-7 zero-count vs. rendered card; consistent chassis ✓; read/write text not demonstrable with nothing installed.                                                                                                                                                                                                                                                        |
| `/evidence`    | **Fail**         | P0-1 red alert. Does not claim semantic quality — evidence is labelled `PROVENANCE RETAINED · SCORES SERVER-OWNED`.                                                                                                                                                                                                                                                      |
| `/incubator`   | **Pass with P1** | Strong: `SAFE LEARNING BOUNDARY · HUMAN CURATION · NO AUTO-COMMIT`, `PAYLOADS WITHHELD`, `8 SIGNALS SHOWN · SUMMARY ONLY`. Fails on P1-3.                                                                                                                                                                                                                                |
| `/settings`    | **Pass with P2** | Truthfully identifies identity, authentication (LOCAL), authorization model (WORKSPACE-ROLE-V1), effective roles and granted permissions; `CONTROL-PLANE BOUNDARIES` honestly lists NOT EXPOSED / NOT CONNECTED / WRITE ROUTE ONLY. P2-3 only.                                                                                                                           |

**Global shell:** rail matches the specified order exactly (00 Today, 01 Attention, 02 Knowledge, 03 AIM, 04 Build, 05 Catalog, 06 Operate, 07 Connections, 08 Evidence, 09 Incubator, Settings). `[` collapses and expands; **state persists across reload**; the shortcut is **correctly suppressed inside the search input** (typing `[[test` entered text and did not collapse). The rail is fixed and never overlapped content at any scroll position. Route changes reset scroll to top. Attention badge (5) matches the queue count (DECIDE 05) — no contradiction.

**Browser integrity:** zero console errors; 7 hydration warnings. All `/v1/*` responses **200** (`/v1/attention`, `/v1/execution-runs`, `/v1/authority-grants`, `/v1/automation-schedules`, `/v1/plugins`). **No external-origin requests observed** on any route, including `/aim` with WebGL active. No broken images or connector marks. One transient renderer freeze (P2-9).

---

## 4. Limitations of this review

These requirements could **not** be tested and are neither passed nor failed:

1. **Responsive at 390 px and 320 px.** `resize_window` reported success but the rendered viewport did not change — every screenshot remained desktop layout. No responsive, touch-target, or mobile-overflow claim in this report.
2. **200 % zoom.** Page-zoom shortcuts are unsupported by the tooling.
3. **Reduced motion and WebGL failure.** No ability to set the OS/browser preference or disable WebGL, so the 2D fallback and animation-stop behaviour are unverified.
4. **Request interception.** Could not force a `/v1/attention` refresh to fail, so stale-card removal, the unavailable state, and Retry are unverified.
5. **Authority-card disclosures.** No authority/execution-approval card was present in the queue during this review (the five decisions were memory and improvement reviews), so "discloses attempt count and retry/backoff policy" could not be evaluated. Note this differs from the state seen in earlier builds.
6. **Post-submit behaviour.** Per the safety rule, no action was submitted — approve/reject/install outcomes, optimistic updates, and error handling are all untested.
7. **Console capture** began after the first page load; messages from the very first load may be missing.
8. Single browser (Chrome), single viewport, one session. No cross-browser check.

---

## 5. Recommended fix order

1. `/evidence` red alert (P0-1) — a visible error on a core route disqualifies a demo.
2. Identifier presentation on `/operate` and `/incubator` (P1-2, P1-3) — mechanical, high visibility.
3. De-duplication in three places: Attention cards, the Today timeline, the Knowledge index (P1-1, P1-8, P1-4).
4. Hide fixture and test entities from search and the knowledge index (P1-5, P1-4).
5. `/build` H1, copy, and icons (P1-6).
6. `/connections` count-vs-content contradiction (P1-7).
7. P2 copy defects — they are individually small and collectively what separates a demo from a product.

---

## 6. The three strongest parts under adversarial use

**1. The honesty discipline is real, and it holds where it costs something.**
This is the hardest thing to fake and the product does it repeatedly: Home says _"Not connected on this machine"_ for meetings rather than inventing them; it declines to render its own chart with _"History contract needed — Paul OS draws no chart because Attention exposes no historical arrived-versus-cleared series"_; Knowledge admits _"100 of 127 definitions are loaded. No missing relationship is inferred"_; AIM states _"2 of 6 modeled groups have no certified agent"_ on its own front page. Every one of these is a place where a lesser build would have shown a plausible number.

**2. Consequence-and-undo on every Attention action.**
Each decision card carries two labelled blocks before the buttons — _"ACCEPT MEMORY · Stores this reviewed value with its source and provenance. UNDO · A later reviewed memory can replace the accepted value"_ and its counterpart. A first-time reader knows what the button does and how to get back before they touch it. This is the single biggest improvement over the earlier build and it survived every card I opened.

**3. Knowledge gets relationship semantics right, which almost nothing does.**
Edges render as `daily-brief V1.1.0 —USED BY→ daily-brief-contract V1.1.0` and `daily-brief V1.1.0 —DEPENDS ON→ briefing-principles V1.0.0`, with exact versions on both ends, the declaring manifest cited as _provenance_ ("Declared by daily-brief-contract V1.1.0") rather than smuggled in as an endpoint, and _"Exact version pin. No semantic relationship is inferred"_ on every edge. The page header states outright that relationships _"come from exact immutable dependency pins, never name matching."_ Direction, provenance and inference boundaries are the three things graph UIs routinely get wrong, and this one gets all three right.
