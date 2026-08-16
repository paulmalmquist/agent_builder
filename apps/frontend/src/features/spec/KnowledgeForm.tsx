import { useState, type FormEvent } from 'react';
import {
  knowledgeSectionSchema,
  type KnowledgeSection,
  type SourceDescriptor,
} from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { issueSummary } from './form-utils';
import { UnresolvedReview } from './UnresolvedReview';
import {
  hasUnresolvedAnswers,
  type InterpretationResolutionById,
  type InterpretationResolutionChange,
  type InterpretationUnresolvedItem,
} from './unresolved-review-utils';

interface KnowledgeFormProps {
  sources: SourceDescriptor[];
  initialValue: KnowledgeSection | null;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  unresolvedItems?: InterpretationUnresolvedItem[];
  resolutions?: InterpretationResolutionById;
  onResolutionChange?: InterpretationResolutionChange;
  onClose: () => void;
  onSubmit: (value: KnowledgeSection) => void;
}

type Selection = KnowledgeSection['sources'][number];

export function KnowledgeForm({
  sources,
  initialValue,
  isLoading,
  isSaving,
  loadError,
  unresolvedItems = [],
  resolutions = {},
  onResolutionChange = () => undefined,
  onClose,
  onSubmit,
}: KnowledgeFormProps) {
  const [selections, setSelections] = useState<Selection[]>(initialValue?.sources ?? []);
  const [error, setError] = useState<string | null>(null);

  function toggleSource(source: SourceDescriptor) {
    setSelections((current) => {
      const selected = current.some((item) => item.descriptorId === source.id);
      if (selected) return current.filter((item) => item.descriptorId !== source.id);
      return [
        ...current,
        {
          descriptorId: source.id,
          purpose: `Use ${source.displayName} as governed context`,
          requiredCitations: source.citationRequired,
        },
      ];
    });
  }

  function updateSelection(
    descriptorId: string,
    update: Partial<Pick<Selection, 'purpose' | 'requiredCitations'>>,
  ) {
    setSelections((current) =>
      current.map((item) => (item.descriptorId === descriptorId ? { ...item, ...update } : item)),
    );
  }

  const resolveInterpretationItem: InterpretationResolutionChange = (itemId, resolution) => {
    onResolutionChange(itemId, resolution);
    if (resolution?.action !== 'map_source') return;
    const source = sources.find((candidate) => candidate.id === resolution.descriptorId);
    if (!source) return;
    setSelections((current) =>
      current.some((selection) => selection.descriptorId === source.id)
        ? current
        : [
            ...current,
            {
              descriptorId: source.id,
              purpose: `Use ${source.displayName} as governed context`,
              requiredCitations: source.citationRequired,
            },
          ],
    );
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = knowledgeSectionSchema.safeParse({ sources: selections });
    if (!result.success) {
      setError(issueSummary(result.error.issues));
      return;
    }
    setError(null);
    onSubmit(result.data);
  }

  return (
    <Modal kicker="Step 02" onClose={onClose} size="wide" title="Define knowledge & access">
      <p>
        Select only server-issued descriptors. Credentials, table names, and arbitrary queries never
        cross this form.
      </p>
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form onSubmit={handleSubmit}>
        <UnresolvedReview
          items={unresolvedItems}
          onChange={resolveInterpretationItem}
          resolutions={resolutions}
          sources={sources}
        />
        <fieldset className="source-grid" disabled={isLoading || isSaving}>
          <legend className="sr-only">Available governed sources</legend>
          {isLoading ? <p>Loading the governed source catalog…</p> : null}
          {sources.map((source) => {
            const selection = selections.find((item) => item.descriptorId === source.id);
            return (
              <div className={`source-card ${selection ? 'selected' : ''}`} key={source.id}>
                <label className="source-select">
                  <input
                    checked={Boolean(selection)}
                    onChange={() => toggleSource(source)}
                    type="checkbox"
                  />
                  <span>
                    <strong>{source.displayName}</strong>
                    <small>
                      {source.provider} · {source.authority.replaceAll('_', ' ')}
                      {source.region ? ` · ${source.region}` : ''}
                    </small>
                  </span>
                </label>
                {selection ? (
                  <div className="source-config">
                    <label>
                      How this source will be used
                      <input
                        onChange={(event) =>
                          updateSelection(source.id, { purpose: event.target.value })
                        }
                        value={selection.purpose}
                      />
                    </label>
                    <label className="check-field">
                      <input
                        checked={selection.requiredCitations}
                        onChange={(event) =>
                          updateSelection(source.id, {
                            requiredCitations: event.target.checked,
                          })
                        }
                        type="checkbox"
                      />
                      Require citations in outputs
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </fieldset>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={isSaving || isLoading || !hasUnresolvedAnswers(unresolvedItems, resolutions)}
            type="submit"
          >
            {isSaving ? 'Saving…' : 'Save knowledge & access'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
