import type { AgentSpec } from '@agent-builder/contracts';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

interface ReviewDialogProps {
  spec: AgentSpec;
  isGenerating: boolean;
  error: string | null;
  onClose: () => void;
  onGenerate: () => void;
}

export function ReviewDialog({
  spec,
  isGenerating,
  error,
  onClose,
  onGenerate,
}: ReviewDialogProps) {
  const { outcomes, knowledge, guardrails, outputs } = spec;

  return (
    <Modal
      kicker="Review & generate"
      onClose={onClose}
      size="wide"
      title={outcomes?.name ?? 'Agent specification'}
    >
      <p>
        This immutable revision will be passed to the deterministic generator. Review the governed
        boundaries before starting.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="review-grid">
        <section>
          <span>Purpose</span>
          <strong>{outcomes?.purpose}</strong>
          <small>
            {outcomes?.department} · revision {spec.revision}
          </small>
        </section>
        <section>
          <span>Knowledge</span>
          <strong>{knowledge?.sources.length ?? 0} governed sources</strong>
          <small>
            {knowledge?.sources.filter((source) => source.requiredCitations).length ?? 0} require
            citations
          </small>
        </section>
        <section>
          <span>Workflow</span>
          <strong>{guardrails?.workflowStages.length ?? 0} auditable stages</strong>
          <small>{guardrails?.failClosedConditions.length ?? 0} fail-closed rules</small>
        </section>
        <section>
          <span>Output</span>
          <strong>{outputs?.outputType.replaceAll('_', ' ')}</strong>
          <small>{outputs?.acceptanceTests.length ?? 0} acceptance tests</small>
        </section>
      </div>
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose} type="button">
          Keep editing
        </button>
        <button
          className="primary-button"
          disabled={isGenerating}
          onClick={onGenerate}
          type="button"
        >
          {isGenerating ? 'Queueing generation…' : 'Generate agent'}
        </button>
      </div>
    </Modal>
  );
}
