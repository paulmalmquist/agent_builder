import { useState, type FormEvent } from 'react';
import type { BuilderDecisionAction } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import type { PendingBuilderDecision } from './ReferredChoicesPanel';

interface ReuseDecisionDialogProps {
  decision: PendingBuilderDecision;
  error: string | null;
  highestMatchScore: number | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (reason: string | null) => void;
}

const actionCopy: Record<
  BuilderDecisionAction,
  { title: string; consequence: string; undo: string; submit: string }
> = {
  use_as_is: {
    title: 'Use the certified agent',
    consequence: 'Creates a deployment from this exact certified release.',
    undo: 'Retire the deployment without changing the shared agent.',
    submit: 'Create deployment',
  },
  configure: {
    title: 'Configure without forking',
    consequence: 'Creates a project overlay against the same immutable agent.',
    undo: 'Remove the overlay to return to the certified defaults.',
    submit: 'Create overlay',
  },
  extend: {
    title: 'Extend as a new lineage',
    consequence: 'Creates a new draft with a recorded link to this agent.',
    undo: 'Discard the draft before it becomes a candidate.',
    submit: 'Create extension draft',
  },
  build_new: {
    title: 'Build a new agent',
    consequence: 'Creates an independent draft from your confirmed scope.',
    undo: 'Discard the draft before it becomes a candidate.',
    submit: 'Create new draft',
  },
};

export function ReuseDecisionDialog({
  decision,
  error,
  highestMatchScore,
  isSubmitting,
  onClose,
  onSubmit,
}: ReuseDecisionDialogProps) {
  const [reason, setReason] = useState('');
  const copy = actionCopy[decision.action];
  const reasonRequired = decision.action === 'build_new' && (highestMatchScore ?? 0) > 80;
  const reasonValid = !reasonRequired || reason.trim().length >= 3;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reasonValid) return;
    onSubmit(reason.trim() ? reason.trim() : null);
  }

  return (
    <Modal kicker="Reuse first" onClose={onClose} title={copy.title}>
      <form className="reuse-decision-form stack-form" onSubmit={submit}>
        <div className="reuse-decision-summary">
          <p>{copy.consequence}</p>
          <p>{copy.undo}</p>
          {decision.choice ? (
            <p className="reuse-decision-source">
              Source: {decision.choice.name} {decision.choice.version} ·{' '}
              {Math.round(decision.choice.match.score)}% match
            </p>
          ) : null}
        </div>
        {decision.action === 'build_new' ? (
          <label htmlFor="build-new-reason">
            <span>
              Why does the referred option not fit? {reasonRequired ? '(required)' : '(optional)'}
            </span>
            <input
              aria-describedby="build-new-reason-help"
              id="build-new-reason"
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              required={reasonRequired}
              value={reason}
            />
            <small id="build-new-reason-help">
              {reasonRequired
                ? 'A match above 80% needs one short reason. Paul OS records it once as demand evidence.'
                : 'A short reason helps improve future referred choices.'}
            </small>
          </label>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-actions">
          <button
            className="secondary-button"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            Keep reviewing
          </button>
          <button className="primary-button" disabled={isSubmitting || !reasonValid} type="submit">
            {isSubmitting ? 'Recording decision…' : copy.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
