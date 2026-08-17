# Coding Prompt — Motion Polish, Sequential Disclosure, Blueprint Canvas

## Role

You are a senior frontend engineer working in `apps/frontend` of the agent-builder monorepo (React 19.1 + TypeScript, Vite 6, TanStack Query 5, Vitest/RTL/MSW). You are shipping a visual-polish revision. You do not touch the backend, contracts package, or API client behavior.

## Design intent

The reference aesthetic is a minimalist technical business card: matte black, white circled numerals on a vertical rail, condensed uppercase labels, and one silver hairline. The current UI is correct but static ("stock React"). Target feel: **aerospace instrument, not consumer app** — slow, precise, restrained motion. Purple (`--purple: #9578ff`) is the only accent. Nothing bounces. Nothing moves faster than 150ms or slower than 5s.

## Repo facts (verified — do not rediscover)

- Entry: `apps/frontend/src/App.tsx` (427 lines). Steps defined in `workflowSteps`; completion state comes from `spec.completion` (`{outcomes, knowledge, guardrails, outputs}`); `allComplete` and `canReview` already derived.
- Step UI: `src/components/WorkflowStep.tsx` — `.workflow-row` > `.step-number` (circle) + `.step-card`, `data-disabled` attr, `complete` prop. Rail is `.workflow-line` in App.tsx.
- Styles: single `src/styles.css` (1244 lines). Tokens in `:root` (`--purple`, `--purple-soft`, `--panel`, `--border`, `--muted`, bg `#05070a`). **No `@keyframes` exist anywhere.** A `prefers-reduced-motion` block exists at ~line 1228 — extend it.
- Static starfield is `.noise` (fixed, CSS radial-gradient dots).
- `.page-shell` is `min-height: 100vh; overflow: hidden` and `.frame` fills the viewport — the page currently cannot scroll. You must allow vertical document scroll for the blueprint section without introducing horizontal overflow.
- Gating today: `disabled={step.step > 1 && !spec}` in App.tsx and `openStep()` allows any step once a spec exists.
- Tests: `src/App.test.tsx` (130 lines) covers current gating; MSW server in `src/test/server.ts`.

## Deliverables

### 1. Sequential disclosure (steps 2–4 locked until predecessor complete)

- Rule (deterministic, derived from `spec.completion`, never from click history): step 1 always enabled; step 2 enabled iff `completion.outcomes`; step 3 iff `completion.knowledge`; step 4 iff `completion.guardrails`. A spec branched from an existing agent may arrive with sections already complete — the rule must handle that.
- Enforce in both `WorkflowStep` props and `openStep()` (clicking a locked step sets a notice: "Complete step 0N first."). Keep existing generating/generated lock behavior.
- Locked visual: opacity ~0.4, grayscale, no hover response, sub-label `LOCKED · COMPLETE STEP 0N FIRST` in 11px uppercase. Use `aria-disabled="true"` + blocked click handler, NOT the `disabled` attribute (keeps steps discoverable to screen readers and focus order stable).
- Unlock transition: 500ms ease-out opacity/filter ramp plus a single 900ms glow flare on the newly unlocked card. Runs once per unlock, not on mount of an already-unlocked step.

### 2. Motion & glow layer (CSS-only; no new dependencies)

- **Rail fill:** layer a second element over `.workflow-line`; its height scales to the furthest completed step (0%, 33%, 66%, 100% of the distance between circle centers). Transition 800ms `cubic-bezier(0.22, 1, 0.36, 1)`. Filled portion is purple with a soft outer glow; unfilled stays the current gray.
- **Step circles:** the next actionable (first incomplete, unlocked) circle gets a breathing ring — `box-shadow` pulse, 4s ease-in-out infinite, purple at ≤0.25 alpha. On completion, circle fills `--purple`, check stamps in with a 300ms scale (1.15→1) — once, via a `data-just-completed` attr or animation on class change, not on every render.
- **Cards:** hover (unlocked only): `translateY(-2px)`, border brightens, chevron icon translates 4px right, 180ms ease. Active step card (matching open dialog) gets a static 1px purple inner hairline.
- **Starfield:** replace static `.noise` with `<StarfieldCanvas />` (`src/components/StarfieldCanvas.tsx`): fixed, `pointer-events: none`, behind `.frame`. ~140 stars in 2 parallax layers, drift ≤4px/s, per-star sine twinkle (period 3–9s, phase random from a **seeded** PRNG — same sky every load). `devicePixelRatio`-scaled; rAF pauses on `document.hidden`. Reduced-motion or canvas-unavailable: render the existing static `.noise` markup instead.
- **Entrance (load only, once):** hero h1 lines and left-column blocks fade-up 600ms, 80ms stagger. Brand glyph dots: one dot brightens briefly every ~7s, staggered.
- **Modals:** backdrop fades 160ms; panel scales 0.98→1 with fade. No exit animation work.
- **Reduced motion:** every animation/transition defined here is disabled in the `prefers-reduced-motion` block; states still render (rail filled, circles completed) — only motion is removed.

### 3. Below-the-fold blueprint canvas

New `src/features/blueprint/BlueprintSection.tsx` rendered in App.tsx after `.frame`, receiving the existing `spec` object (and `job`/`shadowDeployed` if trivially available). Structure:

- `<section id="blueprint">`, min-height 90vh, same black background; heading kicker `AGENT SPECIFICATION — LIVE BLUEPRINT`.
- A scroll cue chip (fixed, bottom center, `VIEW BLUEPRINT ↓`) appears only after `completion.outcomes` is true; clicking smooth-scrolls to `#blueprint`; hides while the section is in view (IntersectionObserver).
- Canvas 2D engineering drawing (no libraries):
  - Faint 24px grid, corner registration marks, thin border frame.
  - **Title block** bottom-right, engineering-drawing style: title (first ~40 chars of `spec.outcomes.purpose`, else `UNTITLED AGENT`), `REV ${spec.revision}`, date, department/audience if present, status (`DRAFT` / `READY` / `GENERATING` / `GENERATED`).
  - **Four stations** left→right: SCOPE, KNOWLEDGE, WORKFLOW, CRITERIA. Complete station: solid border, populated detail lines from real spec data (e.g. knowledge: source count + first 2 source names; workflow: stage count, approval count, prohibited count; criteria: metric count + schema name). Incomplete: dashed border, `PENDING`.
  - Connectors between stations draw in with a line-dash animation (~600ms) when a station newly completes.
  - Diagonal `DRAFT` watermark until `allComplete`; then a `READY FOR GENERATION` stamp with one brief flash.
- **Architecture requirement:** split pure layout from painting. `src/features/blueprint/blueprint-layout.ts` exports `layoutBlueprint(spec, width, height): BlueprintLayout` (node rects, label lines, title-block fields, watermark text) — pure, deterministic, unit-tested. The component owns canvas lifecycle: DPR scaling, `ResizeObserver`, rAF only while an animation is in flight AND the section is intersecting; otherwise paint once and stop.
- Reduced motion: skip draw-in animations, paint final state.

## Constraints

- **Zero new npm dependencies.** CSS + Canvas 2D + existing React only.
- No changes to `packages/contracts`, `src/api/*` request/response behavior, or backend.
- Keep all existing accessibility affordances (focus-visible outlines, aria labels, dialog semantics).
- All timing/easing values become CSS custom properties in `:root` (`--ease-precision`, `--dur-hover: 180ms`, etc.) so they can be tuned in one place.
- No layout shift from animations (animate transform/opacity/box-shadow only; never width/height/margin).
- Keep the governance footer and bottom rule intact.

## Tests (must pass; update/add — never delete)

1. Update `App.test.tsx` gating tests: step 2 locked until outcomes complete; step 3 until knowledge; step 4 until guardrails; locked click shows notice and opens no dialog; branched spec with pre-completed sections unlocks correctly.
2. New `blueprint-layout.test.ts`: empty spec → 4 PENDING stations + DRAFT watermark; partial spec → correct per-station lines; complete spec → READY text, title-block fields, truncation at boundaries.
3. Starfield: renders static fallback under mocked `prefers-reduced-motion: reduce` (jsdom `matchMedia` mock exists in test setup — extend it).

## Acceptance / verification checklist

- `npm run typecheck && npm test && npm run build` green from repo root; coverage does not drop below the configured gate.
- Manual: fresh load → only step 01 interactive, rail empty, one breathing circle. Save scope → step 02 unlocks with single flare, rail fills ⅓, scroll cue appears. Complete all four → rail full, Review & Generate visible, blueprint shows READY stamp.
- Blueprint reflects live data after each save without page reload (it re-renders from the same React Query `spec`).
- OS reduced-motion on → no animation anywhere; all completed states still legible.
- DevTools performance: idle page (no animation in flight, blueprint off-screen) runs zero rAF callbacks.
- No horizontal scrollbar at 1280px and 375px widths; page scrolls vertically to blueprint.

## Failure modes to avoid

- Re-triggering one-shot animations on every React re-render (guard with refs/data attrs keyed to state transitions).
- Starfield or blueprint rAF running while hidden/off-screen (battery drain).
- Using `disabled` attr on locked steps (breaks focus order and SR discoverability).
- Blueprint text overflow: all strings truncated with `…` in the layout function, never clipped by the canvas.
