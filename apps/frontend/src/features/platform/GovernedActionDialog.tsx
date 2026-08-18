import { useState, type FormEvent } from 'react';
import type { ConsoleCopyAction } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

export function GovernedActionDialog({
  action,
  defaultRationale = '',
  error,
  introduction,
  isPending,
  kicker,
  onClose,
  onConfirm,
  rationaleRequired = false,
  title,
}: {
  action: ConsoleCopyAction;
  defaultRationale?: string;
  error: string | null;
  introduction: readonly string[];
  isPending: boolean;
  kicker: string;
  onClose: () => void;
  onConfirm: (rationale: string) => void;
  rationaleRequired?: boolean;
  title: string;
}) {
  const [rationale, setRationale] = useState(defaultRationale);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onConfirm(rationale.trim());
  }

  return (
    <Modal kicker={kicker} onClose={onClose} title={title}>
      <form className="governed-action-form" onSubmit={submit}>
        <div className="governed-action-introduction">
          {introduction.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="governed-action-copy">
          <strong>{action.consequence}</strong>
          <span>{action.undo}</span>
        </div>
        {rationaleRequired ? (
          <label>
            <span>RATIONALE · RECORDED PERMANENTLY</span>
            <textarea
              autoFocus
              maxLength={2_000}
              minLength={10}
              onChange={(event) => setRationale(event.target.value)}
              required
              rows={4}
              value={rationale}
            />
          </label>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            KEEP CURRENT STATE
          </button>
          <button className="primary-button" disabled={isPending} type="submit">
            {isPending ? 'WORKING…' : action.label.toUpperCase()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
