# What WebGL Is Actually For Here

You were right about the blobs. Liquid-for-liquid's-sake is a technique demo, and technique demos age badly. Here's the principle I should have started from.

## The test

**Only use WebGL for something the DOM physically cannot do.** Not "cannot do as prettily" — cannot do. There are four of those:

1. **Draw 10,000+ individual marks at 60fps.** The DOM dies around a thousand nodes. So scale itself becomes available as a design material: every issue, every run, every part as its own visible thing.
2. **Continuous zoom across scales** with no page transitions — program → vehicle → part → single item as camera movement, not navigation.
3. **Time as a scrubbable axis.** Replay six months in nine seconds and watch structure emerge.
4. **Per-pixel computation.** Every pixel can be a data lookup — density fields, distance fields, occlusion.

If an idea doesn't need at least one of those, it should be SVG, and it will be faster and more accessible as SVG.

## The build: work condensation

`mockups/paulos-work-condensation.html` — uses three of the four.

**9,000 work items, each drawn as one GPU point.** Not a bar chart of work — the actual population. Items start as a diffuse cloud far from the vehicle and **collapse inward as they move through states**, until finished work lies on the skin of the hardware it produced. Work condensing into a rocket is not a metaphor I invented for looks; it's what the program literally does.

**Scrub 26 weeks in nine seconds.** The whole state machine is computed in the vertex shader from four per-item timestamps, so scrubbing 9,000 items costs nothing. Drag the slider and six months of program history plays.

**And then the thing you can't get any other way:** around week 14 an **amber shell forms and refuses to land** on Factory ops and Integration. That's the review queue jamming. In the cumulative-flow chart it's a band getting wider — true, but you have to be taught to read it. Here it's a cloud of work orbiting the vehicle that never touches down, and nobody needs the chart explained. 518 items glow red because they've sat in review longer than they should have.

That's the argument for WebGL in one image: **the bottleneck is a shape, and you see it four weeks before it becomes a missed date.**

## Other ideas that pass the same test

- **One continuous space instead of pages.** A single canvas where zooming out shows the program, zooming in shows a group, further shows a part, further shows one work item's history. Navigation becomes camera movement. This is the biggest idea on this list and the most work.
- **Evidence at depth.** A decision doesn't open a modal — you push _into_ it, and the citations are physically behind it on the z-axis. Depth as provenance.
- **Run execution as flow along real topology.** Particles moving agent → plugin → outcome on the actual dependency graph. A stuck run's particles freeze mid-wire. Needs #1 and #4.
- **Density field for the backlog.** Per-pixel accumulation showing where work concentrates by zone and age — a heatmap you couldn't rasterise in the DOM at this resolution.
- **The catalogue as a physical library.** Every certified resource with real depth, occlusion and DOF, so browsing feels like walking a stack rather than paging a list.

## What survives from the liquid study

One idea, and it's a good one: **clarity as certification.** A certified release refracts cleanly so you see its evidence through it; a candidate scatters and goes cloudy; index of refraction scales with the strength of the guarantee. Certainty as an optical property is worth keeping — as a _material_ applied to registry objects, not as a screen full of floating blobs.

The file's still in `mockups/paulos-liquid-webgl.html` if you want the shader. The technique is sound; the composition was the mistake.

## The rules that still hold

Same as before, because they're what make any of this credible: render on demand, pause on `visibilitychange`, cap DPR, budget 16ms, and ship a **complete** fallback rather than a degraded one. And none of this goes near Attention, Operate, Evidence, or Settings — spectacle belongs where you browse and think, never where you decide and leave.
