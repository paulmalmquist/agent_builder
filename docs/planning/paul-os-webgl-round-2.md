# WebGL Round 2 — Three Built Mockups, One Per Facet

Companion to `paul-os-webgl-design-ideas.md`. That memo set the test: only use WebGL where the DOM
physically cannot follow — 10,000+ marks, continuous zoom, scrubbable time, per-pixel computation.
This round applies the test to the three faces of the OS and ships a mockup for each. All three are
self-contained single files in `mockups/`, no CDN, DPR capped at 2, pause when hidden, and each
carries a complete flat fallback — the same information, not a degraded scene.

**The OS is one system seen through three facets: it builds and runs agents (the factory), it
remembers what you did (the ledger), and it shows what needs you now (the face).** One mockup each,
and all three replay the same fictional program — the week-14 review jam appears in all of them, so
the facets rhyme.

---

## 1 · `paulos-run-current.html` — the factory facet

One day of the fleet: 2,600 runs, each a single GPU point, flowing trigger → agent → tool → gate →
outcome across the real topology. The whole day is eight timestamps per run, replayed in the vertex
shader — scrubbing costs nothing (the same trick as the condensation piece).

The image that matters: **the amber pool that forms in front of "your approval."** Runs finish,
queue, and orbit the gate like an accretion disc while auto-checks flow freely above. You clear it
in two sittings; after five o'clock nobody approves, and 241 runs are still orbiting at midnight —
tomorrow's first decision, visible as a shape. The factory was never the bottleneck; the queue in
front of you was. This is the population view of runs that no per-run trace waterfall (Langfuse,
LangSmith) shows.

Uses powers #1 and #3 (scale + scrubbable time). Belongs on the run observatory surface — Operate
stays a table.

## 2 · `paulos-history-terrain.html` — the ledger facet

Twenty-six weeks × nine workstreams as a ridgeline landscape. Height is what landed each week; the
dashed hairline is what the plan said; past is solid, future is ghost. On load it replays
March→today in eight seconds. Drag to orbit, hover any peak for the week's numbers in plain words.

The image that matters: **the week-14 amber mountain on Factory ops and Integration, with the plan's
dashed line running flat underneath it** — and eight silent weeks of Evaluations lying in a valley
just behind. The starvation and the jam are one story, and you see the causality as geography.
Ancestry: GitHub's Skyline made contribution terrain a known pleasure; this makes it an argument.

Uses powers #2 and #3 (one continuous space + time as an axis). Belongs on a retrospective /
history surface, and it's the natural hero for a quarterly report.

## 3 · `paulos-signal-wall.html` — the face facet

106 live signals — every agent, connector, stream, program vital, and you — each one a horizon
strip two to four pixels tall, all redrawn every frame from a ring-buffer texture. Amber folds mean
worse than usual, purple means calmer; fold depth is distance from normal. Research basis: horizon
graphs stay readable at tiny heights precisely because of layered mirrored bands (Heer, Kong &
Agrawala, "Sizing the Horizon," CHI 2009).

The image that matters: **the wall re-sorts itself.** Anomalies physically swim to the top and the
top three expand into annotated charts with a plain-language reason ("failing 1 call in 8 and
climbing — started 40 min ago"). Flip to SORT · GROUPED and the same incidents are buried inside
their org groups — the two buttons are the argument for attention-sorting. Fisheye on hover reads
the wall like a finger on a spine.

Uses powers #1 and #4 (mark count + per-pixel data lookup): ~54,000 live points while rows swim and
fisheye. **Placement rule: this is the room display, not the queue.** Attention stays a flat list;
the wall is what the same data looks like from across the room.

---

## Ideas from the wider field worth stealing next

**The knowledge graph on GPU forces is now a solved problem.** cosmos.gl — the engine behind
Cosmograph — runs force layout entirely on the GPU and joined the OpenJS Foundation; a million
nodes in a browser is routine. Our graph is hundreds of nodes, so the win isn't scale, it's
_motion under load_ plus depth-of-field as the reading aid (visual-tier plan item 3 stands).

**A quarterly Felton report.** Nicholas Felton spent ten years turning one person's year into a
designed annual report. The ledger facet already has the data; an agent that emits a print-grade
"Annual Report of Paul, Q3 2026" — typography first, one terrain flyover as the hero — is the most
shareable artifact this system could produce, and nobody expects an ops tool to produce it.

**Perfetto-grade trace for a single run.** Run-current shows the population; clicking one dot
should eventually push into a flame view of that run's spans. Chrome's tracing UI proves canvas/GL
flame charts stay smooth at hundreds of thousands of spans; every LLM-observability product still
ships a DOM waterfall. Depth continuity: dot → flame is a camera move, not a page.

**Semantic zoom stays the biggest idea.** deck.gl's GPU aggregation layers (screen-grid, hexbin,
heatmap) show the technique for one continuous surface that re-aggregates as you zoom — program →
stream → item without a page transition. This is the long-term shape of the console's browse tier.

**Aesthetic discipline: Ryoji Ikeda's data works** (test pattern, data-verse) are the north star
for the wall: monochrome density, hairlines, one accent, zero decoration. When in doubt, remove.

**Stack note.** three.js WebGPURenderer + TSL kept maturing through 2026 and is the right home for
the force-graph compute pass when we build it. These three mockups stay raw WebGL2 on purpose:
offline, export-controlled, zero dependencies, runs on the locked-down box.

## What held from the old rules

No CDN. Render on demand. Pause on `visibilitychange`. DPR ≤ 2. 16 ms budget. Complete fallbacks.
Nothing touches Attention, Operate, Evidence, or Settings. Health and effect are never carried by
color alone — every state also lands in text (counters, captions, tooltips), per the mark-system
rule and the CVD-validated palette (`#9578ff` / `#2f9d82` series, amber/red reserved for status).

## Suggested order

1. Wire run-current to real run events (the model exists; the amber pool becomes a live metric:
   queue-age-in-front-of-you).
2. Terrain from the actual repo history + time tracking — it's a weekly artifact, not a live view.
3. Wall last — it wants the metrics catalog (10-metrics) to be real first.

Sources: [cosmos.gl / OpenJS](https://openjsf.org/blog/introducing-cosmos-gl) ·
[Cosmograph](https://cosmograph.app/docs-general/concept/) ·
[Sizing the Horizon (CHI 2009)](https://dl.acm.org/doi/10.1145/1518701.1518897) ·
[Feltron Annual Reports](<https://en.wikipedia.org/wiki/Nicholas_Felton_(graphic_designer)>) ·
[deck.gl GPU aggregation](https://deck.gl/docs/api-reference/aggregation-layers/overview) ·
[GitHub Skyline](https://github.com/github/gh-skyline) ·
[Ikeda data-verse](https://www.metalocus.es/en/news/data-verse-universe-micro-and-macroscopic-ryoji-ikeda) ·
[three.js WebGPURenderer](https://threejs.org/manual/en/webgpurenderer.html) ·
[Langfuse agent tracing](https://langfuse.com/blog/2024-07-ai-agent-observability-with-langfuse)
