import { useId, useState, type FormEvent } from 'react';
import { consoleCriticalCopy, promotionRequestSchema } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

interface PromotionDialogProps {
  agentName: string;
  isPromoting: boolean;
  error: string | null;
  onClose: () => void;
  onPromote: (rationale: string) => void;
}

export function PromotionDialog({
  agentName,
  isPromoting,
  error,
  onClose,
  onPromote,
}: PromotionDialogProps) {
  const rationaleId = useId();
  const [rationale, setRationale] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = promotionRequestSchema.pick({ rationale: true }).safeParse({ rationale });
    if (!result.success) {
      setValidationError('Provide a promotion rationale of at least 10 characters.');
      return;
    }
    setValidationError(null);
    onPromote(result.data.rationale);
  }

  return (
    <Modal kicker="Human approval required" onClose={onClose} title={`Promote ${agentName}`}>
      <p>{consoleCriticalCopy.promotion.introduction.join(' ')}</p>
      <p className="os-disclosure">
        {consoleCriticalCopy.promotion.actions[0].consequence}{' '}
        {consoleCriticalCopy.promotion.actions[0].undo}
      </p>
      {validationError ? <Notice tone="error">{validationError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="stack-form" onSubmit={handleSubmit}>
        <label htmlFor={rationaleId}>
          Promotion rationale
          <textarea
            id={rationaleId}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Explain why this evidence supports replacing the current champion."
            value={rationale}
          />
        </label>
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={isPromoting} type="submit">
            {isPromoting ? 'Recording decision…' : consoleCriticalCopy.promotion.actions[0].label}
          </button>
        </div>
      </form>
    </Modal>
  );
}
