# WebGL Round 3 — The Builder Itself, Made Malleable

Rounds 1–2 put WebGL on the _observing_ surfaces. This round is about the _building_ surface: the
node-and-connector editor everyone knows, kept exactly as that idiom — ports, wires, cards — but
made physical, so configuring an agent feels like wiring a bench instead of filling a form.
Built: `mockups/paulos-assembly-bench.html`. Grounded in the real stack, not an imagined one.

---

## The layers we actually have (from the repo, worth rendering as layers)

Reading `.env.example` and `docker-compose.yml`, the connector stack is already a physical story:

1. **Model boundary** — provider is a policy (`MODEL_PROVIDER=deterministic` vs direct), with a
   price stamped on it ($/Mtok in, $/Mtok out). The model is the agent's power supply, not its brain
   housing.
2. **Control plane** — backend + worker + postgres. Workers hold leases and heartbeats; runs are
   claimed, not grabbed.
3. **Connectors** — BigQuery is opt-in, **read-only by design, with a bytes-billed cap**
   (`BIGQUERY_MAXIMUM_BYTES_BILLED`). Confluence, Jira, email, Slack, telemetry all exist in config
   and **fail closed** until configured. The roster is honest: most jacks are shuttered today.
4. **The broker's glass** — workstation residency, device cert + user token, no silent fallback.
5. **Plant systems** — manufacturing, planning, and quality systems behind the glass; the only
   place writes have consequence.
6. **The front door** — OIDC `fail_closed`. Even identity refuses by default.

Fail-closed is the house style of this stack. The bench renders that literally: unconfigured
connectors are shuttered cards, and nothing routes around a dark door.

## What the bench does (built)

The founding memo's agent — _investigate anomalous build telemetry_ — wired by hand:

- **Classic node grammar, modernized.** Cards with the connector-mark chassis and monograms,
  hollow terminals for read, filled for write, dot-grid bench. All words are DOM (crisp, cold-read);
  all wires, packets, rings and glass are GL.
- **Wires are soft bodies.** A declared-but-not-granted capability is a dashed plug dangling off
  the agent, and granting it is a drag — the wire sags, settles, pulls taut. Authority feels like
  plugging something in, because it should cost a gesture.
- **The write wire threads your approval ring.** It cannot seat without the ring in circuit, and
  the grant itself is a flat text dialog stating consequence and undo. The malleable scene shapes;
  the boring dialog commits. That split is the rule.
- **Plant-side wires pass the broker's glass** — a visible kink at the door, device-cert and token
  keyholes. Toggle the broker offline and those wires go slack and dark; a dry run fails _loudly_
  at the door. No silent fallback, rendered.
- **The BigQuery jack has an aperture** — the bytes-billed cap as a click-to-set iris. A cost
  guardrail you can see is a guardrail people believe.
- **Tier is altitude.** Grants accrue → T1 → T2 → T3; the card climbs its ladder and the governance
  arrives as hardware: audit tap always, citations tap at T2, the ring and 20 certification
  fixtures at T3. Authority and obligation arrive together, visibly.
- **Dry run = certification fixtures, live.** Three historical cases run the bench as glyph packets
  (waveform, table, document); the hold case waits at your ring; the false alarm must come out
  clean. Outcomes stack as cited bricks at the schema die.
- Manifest panel mirrors every gesture in YAML — same shape as the founding memo's manifest. The
  scene is a render of the manifest, never the other way around.

## The rest of the malleable vocabulary (ranked next builds)

1. **Envelope as membrane.** The authority envelope as a taut shrink-wrap hull around the granted
   set — drafting-style, 1px edge, not goo. Widening scope stretches it; tension and warmth rise
   with tier; enclosing a T4 tool makes it visibly strain before the flat confirm. Scope cost as
   surface tension.
2. **Blast radius as light.** Hover any write grant and everything downstream in lineage lights up
   in a cone; read-only tools cast no light. The blast-radius analyst already computes this set —
   this is just rendering authority as reach.
3. **Certification wind tunnel.** The pre-deploy chamber as a physical test: fixture particles blow
   through the assembled agent, misses dent a plate with the case id, and the deploy lever stays
   physically locked until every gate dial passes. `CERTIFICATION_*` is already in the env.
4. **Context strata.** Precedence (ADR-0004) as translucent sediment layers the prompt-light passes
   through; drag to reorder; two layers writing the same key show an interference fringe at the
   overlap. Configuration errors become optical artifacts you can point at.
5. **Model boundary as power supply.** Provider policy as a keyed switch (deterministic / direct),
   price-per-Mtok stamped on the housing, a live cost meter fed by the worker. Swapping providers
   should feel like swapping a PSU — deliberate, keyed, priced.
6. **The stockroom.** The connector catalog as a parts wall: certified connectors machined and
   clear (the liquid study's surviving idea — clarity as certification), community ones rough-cast,
   fail-closed ones shuttered bins. Picking a part off the wall starts a bench session with it.

## Rules carried forward

Same as rounds 1–2, plus two new ones this round earned: **the malleable scene shapes, a flat
dialog commits** (no consequential grant ever rides on a gesture alone), and **the manifest is the
truth** — every physical state has a text twin on screen at all times. No CDN, DPR ≤ 2, sleeps when
settled, complete flat fallback (the knows/can-do schematic as a list), reduced motion gets the
assembled end-state painted once.

Sources: repo `.env.example` (BigQuery read-only + bytes cap, fail-closed connector roster, OIDC
fail_closed, worker leases), `docker-compose.yml` (control-plane services), `paul-os-mark-system.md`
(chassis, terminals, grant line-styles), founding project memo (the manifest this bench wires).
