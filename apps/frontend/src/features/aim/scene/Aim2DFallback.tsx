import { FallbackCapabilityNode } from './FallbackCapabilityNode';
import type { AimSceneModel } from './scene-types';

interface Aim2DFallbackProps {
  model: AimSceneModel;
  reason: 'loading' | 'reduced_motion' | 'webgl_unavailable';
  onSelectPart: (partId: string) => void;
}

const reasonCopy = {
  loading: 'Preparing the local conceptual scene. Program details remain available below.',
  reduced_motion: 'Motion is reduced. This static program view shows the same derived state.',
  webgl_unavailable: '3D rendering is unavailable. This 2D view preserves every program action.',
} as const;

export function Aim2DFallback({ model, reason, onSelectPart }: Aim2DFallbackProps) {
  const mappedParts = model.parts.filter((part) => part.anchor.kind === 'mapped');
  const fallbackParts = model.parts.filter((part) => part.anchor.kind === 'fallback');

  return (
    <section className="aim-fallback" data-aim-fallback={reason}>
      <header>
        <div>
          <span>2D PROGRAM VIEW</span>
          <strong>{reasonCopy[reason]}</strong>
        </div>
        <small>{model.parts.length} CAPABILITY COMPONENTS</small>
      </header>
      <section className="aim-fallback-stack" aria-label="AIM conceptual component stack">
        {mappedParts.map((part) => (
          <button
            className="aim-fallback-part"
            data-lifecycle={part.lifecycle}
            key={part.id}
            onClick={() => onSelectPart(part.id)}
            type="button"
          >
            <span aria-hidden="true" className="aim-fallback-part-mark" />
            <span>
              <strong>{part.label}</strong>
              <small>
                {part.lifecycle.toUpperCase()} · {part.readiness.replace('_', ' ').toUpperCase()}
              </small>
            </span>
          </button>
        ))}
      </section>
      {fallbackParts.length > 0 ? (
        <div className="aim-fallback-nodes" aria-label="Unmapped conceptual components">
          {fallbackParts.map((part) => (
            <FallbackCapabilityNode key={part.id} onSelect={onSelectPart} part={part} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
