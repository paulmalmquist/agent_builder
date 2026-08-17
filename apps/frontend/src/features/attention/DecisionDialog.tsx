import { useId, useState, type FormEvent } from 'react';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

interface DecisionDialogProps {
  title: string;
  kicker: string;
  explanation: string;
  consequence: string;
  undo: string;
  reviewFacts: Array<{ label: string; value: string }>;
  confirmLabel: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (rationale: string) => void;
}

export function DecisionDialog({
  title,
  kicker,
  explanation,
  consequence,
  undo,
  reviewFacts,
  confirmLabel,
  isPending,
  error,
  onClose,
  onConfirm,
}: DecisionDialogProps) {
  const rationaleId = useId();
  const [rationale, setRationale] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = rationale.trim();
    if (value.length < 10) {
      setValidationError('Explain this decision in at least 10 characters.');
      return;
    }
    setValidationError(null);
    onConfirm(value);
  }

  return (
    <Modal kicker={kicker} onClose={onClose} title={title}>
      <p>{explanation}</p>
      <div className="decision-consequence">
        <p>
          <strong>What happens</strong>
          {consequence}
        </p>
        <p>
          <strong>Undo</strong>
          {undo}
        </p>
      </div>
      {reviewFacts.length > 0 ? (
        <dl className="attention-review-facts decision-review-facts">
          {reviewFacts.map((fact) => (
            <div key={`${fact.label}:${fact.value}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {validationError ? <Notice tone="error">{validationError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="stack-form" onSubmit={submit}>
        <label htmlFor={rationaleId}>
          Decision rationale
          <textarea
            id={rationaleId}
            maxLength={2_000}
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Explain why this is the right decision now."
            required
            value={rationale}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={isPending} type="submit">
            {isPending ? 'Recording decision…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
