# Getting Off Basic React — What to Steal From an Award Site, and What Not To

Companion to `mockups/paulos-vehicle-webgl.html` (self-contained, runs offline, no CDN).

---

## 1. What that site actually is

SNR4 is a creative developer's portfolio out of Mexico City — 11 project slides, FWA / CSSDA / Awwwards recognition, three credited Sketchfab models (a Quetzalcoatl, a Mexican pyramid, an astronaut) under CC BY. Three.js/WebGL hero, scroll-driven navigation, "Scroll to discover."

I couldn't watch it move — the browser extension dropped mid-session — so the motion notes below are from the genre rather than from that exact page. Worth you spending five minutes on it yourself with these facets in mind.

**Its facets, taken apart:**

| Facet                             | What it does                             | Transferable to us?                                |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| **WebGL hero with real 3D**       | Establishes craft in the first second    | **Yes** — but only where 3D carries information    |
| **Slide/scene-based navigation**  | Each project is a "place," not a section | **Partly** — as spatial memory, not scroll-jacking |
| **Scroll-driven camera**          | Scroll moves a camera, not a scrollbar   | **No** — hostile in an operations tool             |
| **Preloader**                     | Buys time to compile shaders, sets tone  | **Yes, once per session** — as a boot sequence     |
| **Page transitions**              | Nothing cuts; everything traverses       | **Yes** — this is the biggest single win           |
| **Custom cursor**                 | Signature, hover affordance              | **No** — costs precision, gains nothing            |
| **Material honesty**              | Real light, depth, refraction            | **Yes** — the most valuable steal                  |
| **Bespoke type + grid**           | Nothing looks like a component library   | **Yes** — you're already most of the way there     |
| **Hidden performance discipline** | 60fps or it doesn't ship                 | **Yes, non-negotiable**                            |

---

## 2. The argument you need before writing any shader

**A portfolio and an operations console have opposite jobs.** The portfolio wants you to _linger and be impressed_. Paul OS wants you to _decide and leave_ — your own goal state is literally "All quiet."

So the failure mode here is specific and expensive: you bolt award-site patterns onto a daily tool and every 800ms transition becomes a tax you pay on every decision, forever. Scroll-jacking a queue is worse than a plain list. A cursor-follow blob over an approval button is a liability.

**Steal the craft, not the format.**

The craft is: material honesty, motion continuity, choreographed reveal, bespoke type, and ruthless frame budgets. Those are all compatible with a fast tool. The format — hero → scroll → slides → transitions — is not.

### Where spectacle is earned

| Surface                        | Verdict     | Why                                                                                       |
| ------------------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| **AIM vehicle**                | **Go hard** | Already 3D. Spatial by nature. Seen occasionally, at length.                              |
| **Knowledge graph**            | **Go hard** | A 3D force graph genuinely beats a list here — depth separates a subgraph from a hairball |
| **Run / execution view**       | **Medium**  | A run is a flow through a topology. Show the flow.                                        |
| **"All quiet" empty state**    | **Go hard** | Zero cost — there is by definition no work pending                                        |
| **Boot / cold load**           | **Medium**  | Once per session, replaces a spinner you already pay for                                  |
| **Attention queue**            | **Never**   | Decisions must be instant. Motion here is pure tax.                                       |
| **Tables, evidence, settings** | **Never**   | You're reading, not admiring                                                              |
| **The Gantt**                  | **Never**   | A 3D timeline is a party trick that costs legibility                                      |

That last row is the point. Knowing where to stop is what separates this from a demo reel.

---

## 3. Nine specific things to build

**1 · Coverage as a material, not a colour.** _(built — open the file)_
Emissive intensity = certified agent coverage. Surface roughness = evidence age, so stale evidence literally dulls. Quality and Avionics render dark and matte, and pulse almost imperceptibly — a part with no owner is asking for one. You can read program health across the room without a legend. **No dashboard does this.**

**2 · Exploded view as the selection mechanism.** _(built)_
Selecting a group doesn't filter a list — the owned parts advance toward the viewer and everything else recedes and fades into fog. Selection becomes a physical event.

**3 · The knowledge graph in 3D, with GPU forces.**
Nodes = definitions, edges = version pins. Run the force simulation in a compute pass (GPGPU ping-pong on WebGL2, or a real compute shader on WebGPU) so 500+ nodes hold 120fps. Then use **depth of field as the reading aid**: the focused subgraph is sharp, everything else bokehs out. That is how you make a graph legible instead of a hairball — and it's a genuinely better representation than the list you have now.

**4 · Runs as particle flow.**
A run isn't a progress bar — it's particles traveling a wire from agent → plugin → outcome. Density encodes cost. A paused run's particles freeze mid-flight, so a stuck run is visible from across the page with no status text.

**5 · Depth as attention hierarchy.**
Real z-depth plus a 2–3px DOF blur on everything that isn't the focused decision. "Attention" stops being a page name and becomes a rendering property.

**6 · Status as texture, not dots.**
A degraded plugin doesn't get an amber pip — its card material picks up a slow scanline displacement. Colour stays as reinforcement; the _surface_ carries the state.

**7 · Boot sequence instead of a spinner.**
Cold load: rail numerals draw in as registration marks, the starfield seeds from a fixed PRNG so it's the same sky every time, the vehicle wireframes then materializes. 900ms, once per session, skippable. You already pay for shader compile — spend it on tone.

**8 · The signature moment: "All quiet."**
When the queue clears, the scene does one thing — the vehicle rotates to a rest attitude, the starfield parallax settles, one distant flare. It costs nothing because there is no pending work, and it makes clearing the queue _feel_ like something. This is the moment people will describe to other people.

**9 · MSDF type in the scene.**
Signed-distance-field text so labels inside the 3D view stay crisp at any zoom and occlude correctly behind geometry. This is the difference between "3D view with HTML labels floating over it" and one coherent object.

---

## 4. The stack

Keep React for the shell — it's fine, and throwing it away costs months for nothing. Add a rendering tier underneath it.

```
react-three-fiber + drei     three.js as React components — composes with your shell
three.js r169+               renderer, materials, postprocessing
postprocessing / EffectComposer   bloom, DOF, film grain, chromatic aberration
GSAP + ScrollTrigger         choreography and timelines (or Motion if you want React-native)
Lenis                        smooth scroll, if you ever want scroll-driven anything
custom GLSL                  the signature materials — coverage emission, status displacement
MSDF text (troika-three-text) crisp labels in-scene
```

**The forward-looking call:** three.js's **WebGPURenderer + TSL** (Three Shading Language) is where this goes next. Node-based materials, real compute shaders for the graph forces, and a WebGL2 fallback path that three handles for you. Every award site from the last three years is WebGL2. Building the graph tier on TSL now is how this looks current in two years instead of dated.

**Bundle everything. No CDNs.** The demo I built imports nothing at runtime — three.js is inlined, 520 KB, works with the network unplugged. That isn't a preference; your work environment is offline and export-controlled, and a page that phones a CDN on render is a page that fails there. It also means shader compile is the only cold-start cost.

---

## 5. The rules that keep it fast

Award sites feel good because they're 60fps, not because they're heavy. The discipline:

- **Render on demand.** No rAF when nothing moves. The demo only composites when controls move, a transition is in flight, or something is animating.
- **Pause on hidden.** `visibilitychange` kills the loop. No battery drain in a background tab.
- **Instance everything repeated.** One draw call for the engine cluster, not five.
- **Cap DPR at 2.** Retina at 3× is invisible and costs 2.25×.
- **Complete fallbacks, never degraded ones.** No WebGL → the 2D schematic with the _same information_. Reduced motion → final state, painted once. The demo does both, and says so on screen.
- **Budget: 16ms.** If a beautiful idea can't hold that, it doesn't ship. That rule is what makes the rest of it credible.

---

## 6. Order to build

1. **Vehicle tier** — take the demo's material model into the real AIM view, bound to actual coverage and evidence-age fields. One surface, immediate payoff, zero risk to daily flows.
2. **Boot + all-quiet moments** — cheap, high emotional return, no cost to routine use.
3. **Knowledge graph in 3D** — the second genuinely spatial surface; where TSL/compute earns its keep.
4. **Depth and material language across cards** — DOF focus, status-as-texture. Subtle, applies everywhere, never blocks a click.
5. **Runs as flow** — last, because it needs the run event model to be stable first.

Nothing in that order touches Attention, Operate, Evidence, or Settings. Those stay flat, fast, and boring on purpose — which is what lets the other surfaces be extraordinary.

Sources: [SNR4](https://snr4.com.mx/)
