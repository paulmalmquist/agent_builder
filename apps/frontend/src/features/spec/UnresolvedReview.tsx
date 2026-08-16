import type { SourceDescriptor } from '@agent-builder/contracts';
import type {
  InterpretationResolutionById,
  InterpretationResolutionChange,
  InterpretationUnresolvedItem,
} from './unresolved-review-utils';

interface UnresolvedReviewProps {
  items: InterpretationUnresolvedItem[];
  resolutions: InterpretationResolutionById;
  sources?: SourceDescriptor[];
  onChange: InterpretationResolutionChange;
}

export function UnresolvedReview({
  items,
  resolutions,
  sources = [],
  onChange,
}: UnresolvedReviewProps) {
  if (items.length === 0) return null;

  return (
    <fieldset className="unresolved-review">
      <legend>Resolve interpreted uncertainties</legend>
      <p>
        Map each item to a governed choice or state that it was removed. These decisions become
        immutable specification lineage.
      </p>
      {items.map((item) => {
        const resolution = resolutions[item.id];
        const sourceValue =
          resolution?.action === 'map_source'
            ? `map:${resolution.descriptorId}`
            : resolution?.action === 'remove'
              ? 'remove'
              : '';
        const rationale = resolution?.action === 'acknowledge' ? resolution.rationale : '';

        return (
          <label key={item.id}>
            <span>
              <strong>{item.input}</strong>
              <small>
                {item.kind.replaceAll('_', ' ')} · {item.message}
              </small>
            </span>
            {item.kind === 'source' ? (
              <select
                aria-label={`Resolution for ${item.input}`}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === '') {
                    onChange(item.id, null);
                  } else if (value === 'remove') {
                    onChange(item.id, { unresolvedId: item.id, action: 'remove' });
                  } else {
                    onChange(item.id, {
                      unresolvedId: item.id,
                      action: 'map_source',
                      descriptorId: value.slice('map:'.length),
                    });
                  }
                }}
                value={sourceValue}
              >
                <option value="">Choose a governed mapping or remove the reference</option>
                {sources
                  .filter(
                    (source) =>
                      item.descriptorCandidates.length === 0 ||
                      item.descriptorCandidates.includes(source.id),
                  )
                  .map((source) => (
                    <option key={source.id} value={`map:${source.id}`}>
                      Map to {source.displayName}
                    </option>
                  ))}
                <option value="remove">Remove “{item.input}” from scope</option>
              </select>
            ) : (
              <textarea
                aria-label={`Resolution for ${item.input}`}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange(
                    item.id,
                    value
                      ? { unresolvedId: item.id, action: 'acknowledge', rationale: value }
                      : null,
                  );
                }}
                placeholder="Record the concrete governed decision made during review."
                value={rationale}
              />
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
