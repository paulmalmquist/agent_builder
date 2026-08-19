# Handoff: integrate the WebGL mockups into the Paul OS console

You are working in the Paul OS monorepo (React + Vite frontend in `apps/frontend`, backend in
`apps/backend`, run via Docker Compose at localhost:8080). Four finished WebGL mockups live in this
repo as self-contained HTML files. Your job is to port them into the app as **optional, feature-
flagged views** — the mockups are the spec for look and behavior. Do not redesign them; lift them.

## The source files (treat as the spec)

All in `docs/planning/mockups/`:

1. `paulos-run-current.html` — one day of agent runs as GPU particles flowing trigger → agent →
   tool → gate → outcome, with a time scrubber. The observing view for the run population.
2. `paulos-history-terrain.html` — 26 weeks × 9 workstreams as a 3D ridgeline landscape; plan as
   dashed hairline; past solid, future ghost; orbit + scrub.
3. `paulos-signal-wall.html` — 100+ live horizon strips that re-sort by anomaly; fisheye hover;
   ATTENTION vs GROUPED sort modes. A room/wall display.
4. `paulos-assembly-bench.html` — the agent-building surface: node cards, soft-body cables,
   approval ring on the write wire, broker glass pane, tier ladder, live YAML manifest, dry run.

Rationale and rules behind them: `docs/planning/paul-os-webgl-design-ideas.md` (the four-power
test), `docs/planning/paul-os-webgl-round-2.md`, `docs/planning/paul-os-webgl-round-3-malleable.md`.
Read those three before writing code.

## Where each one goes in the app

Follow the existing conditional-route pattern in `apps/frontend/src/router.tsx` (see `aimRoutes`)
and the flag pattern in `apps/frontend/src/config/feature-flags.ts`.

| Mockup          | New route         | Linked from                                                                | Notes                                                                                                       |
| --------------- | ----------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| run-current     | `/observatory`    | a quiet "flow view" link in the header of `features/platform/RunsPage.tsx` | `/operate` and `/runs` stay flat tables — never embed spectacle there                                       |
| history-terrain | `/history`        | the chart area of `features/home/HomePage.tsx` ("six months as terrain")   | weekly-retrospective surface                                                                                |
| signal-wall     | `/wall`           | `features/platform/RunsPage.tsx` and/or Home                               | register as a **top-level route outside `PlatformShell`** — it is a fullscreen room display with no sidebar |
| assembly-bench  | `/bench/:agentId` | `features/library/AgentDetailDrawer.tsx` and the `/build` flow             | the builder surface; see bench rules below                                                                  |

Add one flag: `visualSurfacesEnabled` from `VITE_VISUAL_SURFACES_ENABLED`, **default false**
(`=== 'true'` — note this is the opposite default from `aimEnabled`, deliberately). Flags off must
produce zero change to the rendered app. Update `config/feature-flags.test.ts` and
`router.test.tsx` accordingly. Gate the new nav/link entries in `components/PlatformRail.tsx` /
page headers behind the same flag.

## How to port (mechanics)

- Each mockup is one HTML file: a `<style>` block, a DOM HUD, and one framework-free `<script>`
  containing raw WebGL (no three.js, no dependencies). Port each into
  `apps/frontend/src/features/visual/<surface>/` as a React component + a plain `.ts` scene module.
  Keep the shader strings and the simulation/layout code **verbatim wherever possible** — they are
  tested and tuned. The React component owns lifecycle; the scene module owns GL.
- Follow the existing canvas-component precedent: `components/StarfieldCanvas.tsx` (+ its test) for
  ref/effect lifecycle, and `features/aim/scene/` for how GL scene code is organized today.
- Extract the shared plumbing once into `features/visual/gl/`: context creation (`webgl2` falling
  back to `webgl`), program compile/link with error surfacing, DPR capped at 2, `visibilitychange`
  pause, render-on-demand / sleep-when-settled loop, resize. Every mockup already implements these
  — dedupe, don't reinvent. On unmount: cancel rAF, remove listeners, free buffers.
- The HUDs (headers, chips, stat rows, captions, legends, manifest panel) become JSX. Map the
  mockups' `:root` tokens onto the app's existing CSS variables (`console-shell.css` / `styles.css`)
  instead of redefining them; add a per-feature CSS file like `features/aim/aim-workspace.css` does.
- Keep every fallback: the no-WebGL flat views and the `prefers-reduced-motion` painted-once paths
  are part of the spec, not extras. In jsdom tests WebGL is absent, so the flat fallback is what
  unit tests will render — assert on it.

## Data: fixtures first, real data where it already exists

Define a typed input contract per surface (e.g. `RunEvent[]`, `WeeklyLoad`, `Signal[]`,
`AgentWiring`). For phase one, extract each mockup's seeded synthetic generator into
`features/visual/<surface>/fixtures.ts` (keep the deterministic seeds). Any surface running on
synthetic data must show a small `FIXTURE DATA` chip in its header — no pretending.

Then bind what the backend already serves (check `api/client.ts` / `api/hooks.ts` before inventing
anything): runs data feeding RunsPage should feed `/observatory`'s timestamps; the agent manifest,
grants, and connector data behind `features/library`, `features/platform/PluginRegistry.tsx` and
`components/connector-marks/` should feed `/bench/:agentId`. Terrain and wall stay on fixtures
until real metrics exist — do not add backend endpoints in this work.

## Bench rules (non-negotiable)

- The bench **reads** the real manifest and grant state; the manifest panel renders the actual
  manifest, live. The scene is a render of the manifest, never a second source of truth.
- The malleable scene shapes; a flat dialog commits. Any grant/revoke gesture must dispatch into
  the existing governed flows (`features/platform/GovernedActionDialog.tsx` /
  `ApprovalDialog.tsx`) — the bench never mutates directly. If mutation wiring is too large for
  this pass, ship the bench read-only with drag disabled and a note; that is acceptable.
- Its no-WebGL fallback already exists in the app: render
  `components/connector-marks/AgentCapabilitySchematic.tsx`.
- Authority is never conveyed by color or shape alone — every state also appears as text (the
  mockups model this; preserve it).

## House rules that apply to all four

No new npm dependencies. No CDN or network fetch at render time (offline, export-controlled).
DPR ≤ 2, render on demand, pause when hidden, 16ms frame budget. Spectacle never touches
Attention, Operate, Evidence, or Settings. All user-facing copy must pass the cold-read test
(what is this, what happened, what do I do) and be registered per the convention in
`lib/user-facing-index.ts`. Match repo lint/prettier and the PR lint gate.

## Sequence the work as three PRs

1. **Scaffolding + observatory**: flag, routes, `features/visual/gl/` shared plumbing, run-current
   ported on fixtures, link from RunsPage. Tests: flag off ⇒ no routes; flag on ⇒ route renders
   flat fallback in jsdom; scrubber updates the displayed clock.
2. **Bench**: `/bench/:agentId` on real manifest data, read-only first, schematic fallback,
   entry links. Tests: manifest text matches API fixture from `test/server.ts`; fallback renders.
3. **Terrain + wall**: both on fixtures; wall as chrome-less top-level route.

Each PR: screenshots in the description (default state + one interaction), `npm run` build/lint/
test green, and flags-off producing an identical app.

## Acceptance checklist

- [ ] `VITE_VISUAL_SURFACES_ENABLED` absent/false ⇒ bundle renders identically to main
- [ ] Four routes render with WebGL, and render their complete flat fallbacks without it
- [ ] Reduced-motion shows final states painted once (no autoplay)
- [ ] No new deps; no runtime network fetches introduced; no changes under Attention/Operate/
      Evidence/Settings pages
- [ ] Bench mutations (if enabled) go only through existing governed dialogs
- [ ] Unit tests added beside each surface; `router.test.tsx` and `feature-flags.test.ts` updated;
      an e2e smoke per route in `e2e/` following the existing pattern
