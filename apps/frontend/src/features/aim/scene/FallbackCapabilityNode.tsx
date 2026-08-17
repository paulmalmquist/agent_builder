import type { AimScenePart } from './scene-types';

interface FallbackCapabilityNodeProps {
  part: AimScenePart;
  onSelect: (partId: string) => void;
}

export function FallbackCapabilityNode({ part, onSelect }: FallbackCapabilityNodeProps) {
  return (
    <button
      className="aim-fallback-node"
      data-lifecycle={part.lifecycle}
      onClick={() => onSelect(part.id)}
      type="button"
    >
      <span className="aim-fallback-node-signal" aria-hidden="true" />
      <span>
        <strong>{part.label}</strong>
        <small>GEOMETRY ANCHOR NOT YET MAPPED</small>
      </span>
      <span aria-hidden="true">OPEN →</span>
    </button>
  );
}
