import { useState, type FormEvent } from 'react';
import type { ExecutionRun } from '@agent-builder/contracts';
import type { ApproveRunInput } from '../../api/client';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

interface ApprovalDialogProps {
  run: ExecutionRun;
  error: string | null;
  isApproving: boolean;
  onApprove: (value: ApproveRunInput) => void;
  onClose: () => void;
}

function tomorrowLocalInput() {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 16);
}

export function ApprovalDialog({
  run,
  error,
  isApproving,
  onApprove,
  onClose,
}: ApprovalDialogProps) {
  const perRunFloor = Math.max(run.estimatedUpperCostUsd, run.maxEstimatedCostUsd, 0.01);
  const [validUntil, setValidUntil] = useState(tomorrowLocalInput);
  const [maxRuns, setMaxRuns] = useState(1);
  const [perRunCost, setPerRunCost] = useState(perRunFloor);
  const [totalCost, setTotalCost] = useState(perRunFloor);
  const [toolScopes, setToolScopes] = useState(run.requiredToolScopes.join(', '));
  const [rationale, setRationale] = useState('Approve the bounded first run of this release.');
  const parsedScopes = toolScopes
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApprove({
      projectId: run.projectId,
      inputConstraints: run.input,
      toolScopes: parsedScopes,
      validUntil: new Date(validUntil).toISOString(),
      maxRuns,
      maxEstimatedCostPerRunUsd: perRunCost,
      totalCostBudgetUsd: totalCost,
      rationale,
    });
  }

  return (
    <Modal kicker="DIGEST-BOUND AUTHORITY" onClose={onClose} title="Approve execution envelope">
      <p>
        This grant applies only to release <code>{run.releaseDigest.slice(0, 14)}…</code>. Scope,
        expiry, run count, or budget changes require a new human decision.
      </p>
      <p className="os-disclosure">
        PROJECT · {run.projectId ?? 'UNSCOPED'} · INPUT CONSTRAINTS DEFAULT TO THIS EXACT RUN
      </p>
      {run.approvalReasons.length > 0 ? <Notice>{run.approvalReasons.join(' · ')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="form-grid" onSubmit={submit}>
        <label>
          Valid until
          <input
            min={new Date().toISOString().slice(0, 16)}
            onChange={(event) => setValidUntil(event.target.value)}
            required
            type="datetime-local"
            value={validUntil}
          />
        </label>
        <label>
          Maximum runs
          <input
            max={1_000_000}
            min={1}
            onChange={(event) => setMaxRuns(event.currentTarget.valueAsNumber)}
            required
            type="number"
            value={maxRuns}
          />
        </label>
        <label>
          Per-run ceiling · USD
          <input
            min={perRunFloor}
            onChange={(event) => setPerRunCost(event.currentTarget.valueAsNumber)}
            required
            step="0.01"
            type="number"
            value={perRunCost}
          />
        </label>
        <label>
          Total budget · USD
          <input
            min={perRunCost}
            onChange={(event) => setTotalCost(event.currentTarget.valueAsNumber)}
            required
            step="0.01"
            type="number"
            value={totalCost}
          />
        </label>
        <label className="full-field">
          Tool scopes
          <input
            onChange={(event) => setToolScopes(event.target.value)}
            placeholder="read:calendar, read:tasks"
            value={toolScopes}
          />
          <small>Comma-separated. Leave empty for a model-only execution.</small>
        </label>
        <label className="full-field">
          Approval rationale
          <textarea
            maxLength={2_000}
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            required
            value={rationale}
          />
        </label>
        <div className="modal-actions full-field">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={isApproving || totalCost < perRunCost}
            type="submit"
          >
            {isApproving ? 'Binding authority…' : 'Approve & queue run'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
