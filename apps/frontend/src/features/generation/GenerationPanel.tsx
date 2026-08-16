import type { EvaluationResponse } from '../../api/client';
import type { GenerationJob } from '@agent-builder/contracts';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';

interface GenerationPanelProps {
  job: GenerationJob | undefined;
  evaluation: EvaluationResponse | undefined;
  isLoading: boolean;
  isRecovering: boolean;
  isShadowDeploying: boolean;
  shadowDeployed: boolean;
  error: string | null;
  onRecover: () => void;
  onShadowDeploy: () => void;
}

export function GenerationPanel({
  job,
  evaluation,
  isLoading,
  isRecovering,
  isShadowDeploying,
  shadowDeployed,
  error,
  onRecover,
  onShadowDeploy,
}: GenerationPanelProps) {
  const progress = job?.progress ?? 0;
  const stateLabel = job?.state.replaceAll('_', ' ') ?? 'loading';

  return (
    <section aria-busy={isLoading} aria-live="polite" className="generation-panel">
      <div className="generation-heading">
        <div>
          <span className="eyebrow">GENERATION JOB</span>
          <h2>{job?.message ?? 'Loading job status…'}</h2>
        </div>
        <span className={`status-chip ${job?.state ?? 'queued'}`}>{stateLabel}</span>
      </div>
      <div
        aria-label={`Generation ${progress}% complete`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="process-progress"
        role="progressbar"
      >
        <span style={{ transform: `scaleX(${progress / 100})` }} />
      </div>
      <div className="progress-meta">
        <span>{progress}%</span>
        <span>Generator {job?.generatorVersion ?? '—'}</span>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {job?.state === 'failed' ? (
        <div className="failure-actions">
          <Notice tone="error">
            <strong>{job.error?.code ?? 'GENERATION_FAILED'}</strong>
            <span>
              {job.error?.message ?? 'Generation stopped before a manifest was produced.'}
            </span>
          </Notice>
          <button
            className="secondary-button"
            disabled={isRecovering}
            onClick={onRecover}
            type="button"
          >
            {isRecovering ? 'Recovering…' : 'Recover agent to draft'}
          </button>
        </div>
      ) : null}
      {job?.state === 'succeeded' && job.manifest ? (
        <div className="manifest-card">
          <div className="manifest-title">
            <span className="success-mark">
              <Icon name="check" />
            </span>
            <div>
              <h3>{job.manifest.name}</h3>
              <p>
                Version {job.manifest.version} · specification revision {job.manifest.specRevision}
              </p>
            </div>
          </div>
          <dl className="manifest-facts">
            <div>
              <dt>Workflow</dt>
              <dd>{job.manifest.workflow.length} stages</dd>
            </div>
            <div>
              <dt>Knowledge</dt>
              <dd>{job.manifest.knowledgeSourceIds.length} governed sources</dd>
            </div>
            <div>
              <dt>Evaluations</dt>
              <dd>{job.manifest.evaluations.length} cases</dd>
            </div>
          </dl>
          <button
            className="primary-button"
            disabled={isShadowDeploying || shadowDeployed}
            onClick={onShadowDeploy}
            type="button"
          >
            {isShadowDeploying
              ? 'Starting shadow deployment…'
              : shadowDeployed
                ? 'Shadow deployment started'
                : 'Deploy to shadow'}
          </button>
        </div>
      ) : null}
      {shadowDeployed ? (
        <div className="evaluation-card">
          <div>
            <span className="eyebrow">SHADOW EVALUATION</span>
            <h3>
              {evaluation?.status === 'complete'
                ? `${Math.round(evaluation.summary.score * 100)}% passed`
                : 'Evaluation is starting'}
            </h3>
          </div>
          {evaluation?.tests.length ? (
            <ul className="evaluation-list">
              {evaluation.tests.map((test) => (
                <li key={test.id}>
                  <span className={`test-status ${test.status}`}>{test.status}</span>
                  <span>{test.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Fixture evaluation cases will appear here when the deployment responds.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
