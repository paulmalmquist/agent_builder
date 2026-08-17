import { FallbackCapabilityNode } from './FallbackCapabilityNode';
import type { AimSceneModel } from './scene-types';

interface AimPartIndexProps {
  model: AimSceneModel;
  onSelectPart: (partId: string) => void;
}

export function AimPartIndex({ model, onSelectPart }: AimPartIndexProps) {
  const mappedParts = model.parts.filter((part) => part.anchor.kind === 'mapped');
  const fallbackParts = model.parts.filter((part) => part.anchor.kind === 'fallback');

  return (
    <div className="aim-part-index">
      <div className="aim-part-index-heading">
        <span>SELECT COMPONENT</span>
        <small>Scene and controls share the same derived state.</small>
      </div>
      <div className="aim-part-index-list">
        {mappedParts.map((part) => (
          <button
            data-lifecycle={part.lifecycle}
            key={part.id}
            onClick={() => onSelectPart(part.id)}
            type="button"
          >
            <span aria-hidden="true" />
            {part.label}
          </button>
        ))}
      </div>
      {fallbackParts.length > 0 ? (
        <div className="aim-fallback-nodes" aria-label="Unmapped conceptual components">
          {fallbackParts.map((part) => (
            <FallbackCapabilityNode key={part.id} onSelect={onSelectPart} part={part} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
