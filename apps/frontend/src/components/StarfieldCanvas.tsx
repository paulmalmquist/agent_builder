/**
 * The console background is deliberately static.
 *
 * A previous implementation kept a full-viewport, high-DPI 2D canvas repainting behind every
 * routed screen. Capturing or invalidating that surface while fixed translucent chrome was being
 * composited could stall the renderer and leave a black frame even though the DOM remained live.
 * Rich canvases still belong to their opt-in visual routes; the persistent shell does not need one.
 */
export function StarfieldCanvas() {
  return (
    <div
      aria-hidden="true"
      className="noise"
      data-starfield-fallback="true"
      data-starfield-mode="static"
    />
  );
}
