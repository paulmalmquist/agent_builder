import { useAgentDetail } from '../api/hooks';
import { getErrorMessage } from '../api/client';
import { Modal } from './Modal';
import { Notice } from './Notice';

interface CandidateDialogProps {
  agentId: string;
  canBranch: boolean;
  isCreating: boolean;
  onClose: () => void;
  onUseAsIs: (agentId: string, name: string) => void;
  onBranch: (agentId: string, mode: 'configure' | 'extend' | 'new') => void;
}

export function CandidateDialog({
  agentId,
  canBranch,
  isCreating,
  onClose,
  onUseAsIs,
  onBranch,
}: CandidateDialogProps) {
  const detail = useAgentDetail(agentId);
  const agent = detail.data;

  return (
    <Modal kicker="Reuse first" onClose={onClose} size="wide" title="Choose how to proceed">
      {detail.isLoading ? <p>Loading the governed agent record…</p> : null}
      {detail.isError ? <Notice tone="error">{getErrorMessage(detail.error)}</Notice> : null}
      {agent ? (
        <>
          <div className="candidate-detail">
            <div>
              <span className={`status-chip ${agent.status}`}>{agent.status}</span>
              <h3>{agent.name}</h3>
              <p>{agent.purpose}</p>
            </div>
            <dl>
              <div>
                <dt>Department</dt>
                <dd>{agent.department}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{agent.owner}</dd>
              </div>
            </dl>
            <div className="capability-list">
              {agent.capabilities.map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </div>
          {!canBranch ? (
            <Notice>
              Define and search your scope first. Those outcomes become the governed branch
              specification.
            </Notice>
          ) : null}
          <div className="decision-grid">
            <button
              className="decision-button"
              disabled={isCreating}
              onClick={() => onUseAsIs(agent.id, agent.name)}
              type="button"
            >
              <strong>Use as-is</strong>
              <span>Select the existing governed version without creating a draft.</span>
            </button>
            <button
              className="decision-button"
              disabled={!canBranch || isCreating}
              onClick={() => onBranch(agent.id, 'configure')}
              type="button"
            >
              <strong>Configure</strong>
              <span>Branch this agent and tune knowledge, policy, and outputs.</span>
            </button>
            <button
              className="decision-button"
              disabled={!canBranch || isCreating}
              onClick={() => onBranch(agent.id, 'extend')}
              type="button"
            >
              <strong>Extend</strong>
              <span>Use its capabilities as the base for a broader job.</span>
            </button>
            <button
              className="decision-button"
              disabled={!canBranch || isCreating}
              onClick={() => onBranch(agent.id, 'new')}
              type="button"
            >
              <strong>Build new</strong>
              <span>Keep the scope, but start without a base agent.</span>
            </button>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
