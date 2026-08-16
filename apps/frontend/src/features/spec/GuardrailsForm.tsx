import { useState, type FormEvent } from 'react';
import { guardrailsSectionSchema, type GuardrailsSection } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { issueSummary, lines } from './form-utils';
import { UnresolvedReview } from './UnresolvedReview';
import {
  hasUnresolvedAnswers,
  type InterpretationResolutionById,
  type InterpretationResolutionChange,
  type InterpretationUnresolvedItem,
} from './unresolved-review-utils';

interface GuardrailsFormProps {
  initialValue: GuardrailsSection | null;
  isSaving: boolean;
  unresolvedItems?: InterpretationUnresolvedItem[];
  resolutions?: InterpretationResolutionById;
  onResolutionChange?: InterpretationResolutionChange;
  onClose: () => void;
  onSubmit: (value: GuardrailsSection) => void;
}

const defaultValue: GuardrailsSection = {
  workflowStages: ['Retrieve governed evidence', 'Draft the requested output'],
  prohibitedActions: [],
  approvalRequirements: [],
  failClosedConditions: ['Stop when a required source is unavailable'],
  responseRequirements: {
    citations: true,
    confidence: true,
    unresolvedConflicts: true,
  },
};

export function GuardrailsForm({
  initialValue,
  isSaving,
  unresolvedItems = [],
  resolutions = {},
  onResolutionChange = () => undefined,
  onClose,
  onSubmit,
}: GuardrailsFormProps) {
  const value = initialValue ?? defaultValue;
  const [workflowStages, setWorkflowStages] = useState(value.workflowStages.join('\n'));
  const [prohibitedActions, setProhibitedActions] = useState(value.prohibitedActions.join('\n'));
  const [approvalRequirements, setApprovalRequirements] = useState(
    value.approvalRequirements.join('\n'),
  );
  const [failClosedConditions, setFailClosedConditions] = useState(
    value.failClosedConditions.join('\n'),
  );
  const [requirements, setRequirements] = useState(value.responseRequirements);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = guardrailsSectionSchema.safeParse({
      workflowStages: lines(workflowStages),
      prohibitedActions: lines(prohibitedActions),
      approvalRequirements: lines(approvalRequirements),
      failClosedConditions: lines(failClosedConditions),
      responseRequirements: requirements,
    });
    if (!result.success) {
      setError(issueSummary(result.error.issues));
      return;
    }
    setError(null);
    onSubmit(result.data);
  }

  return (
    <Modal kicker="Step 03" onClose={onClose} size="wide" title="Define actions & workflow">
      <p>
        Describe an auditable workflow, then make its stop conditions and approval gates explicit.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="form-grid" onSubmit={handleSubmit}>
        <div className="full-field">
          <UnresolvedReview
            items={unresolvedItems}
            onChange={onResolutionChange}
            resolutions={resolutions}
          />
        </div>
        <label className="full-field">
          Workflow stages
          <textarea
            onChange={(event) => setWorkflowStages(event.target.value)}
            value={workflowStages}
          />
          <small>One ordered stage per line.</small>
        </label>
        <label>
          Prohibited actions
          <textarea
            onChange={(event) => setProhibitedActions(event.target.value)}
            placeholder={'Modify source records\nSend external messages'}
            value={prohibitedActions}
          />
        </label>
        <label>
          Human approval required
          <textarea
            onChange={(event) => setApprovalRequirements(event.target.value)}
            placeholder={'Publishing an escalation\nChanging a production workflow'}
            value={approvalRequirements}
          />
        </label>
        <label className="full-field">
          Fail-closed conditions
          <textarea
            onChange={(event) => setFailClosedConditions(event.target.value)}
            value={failClosedConditions}
          />
          <small>The agent stops instead of guessing when any condition applies.</small>
        </label>
        <fieldset className="requirements full-field">
          <legend>Every response must include</legend>
          {(
            [
              ['citations', 'Source citations'],
              ['confidence', 'Confidence statement'],
              ['unresolvedConflicts', 'Unresolved evidence conflicts'],
            ] as const
          ).map(([key, label]) => (
            <label className="check-field" key={key}>
              <input
                checked={requirements[key]}
                onChange={(event) =>
                  setRequirements((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="modal-actions full-field">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={isSaving || !hasUnresolvedAnswers(unresolvedItems, resolutions)}
            type="submit"
          >
            {isSaving ? 'Saving…' : 'Save actions & workflow'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
