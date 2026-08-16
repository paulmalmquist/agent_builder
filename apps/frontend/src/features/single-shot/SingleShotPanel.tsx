import { useId, type FormEvent } from 'react';
import type { InterpretSpecResponse } from '@agent-builder/contracts';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import type { WorkflowStepId } from '../../components/WorkflowStep';

interface SingleShotPanelProps {
  prompt: string;
  interpretation: InterpretSpecResponse | null;
  isInterpreting: boolean;
  error: string | null;
  onPromptChange: (prompt: string) => void;
  onInterpret: () => void;
  onSelectSplit: (candidateId: string) => void;
  onReviewStep: (step: WorkflowStepId) => void;
  onSwitchGuided: () => void;
}

const sectionLabels = {
  outcomes: 'Scope',
  knowledge: 'Knowledge',
  guardrails: 'Workflow',
  outputs: 'Criteria',
} as const;

const sectionSteps = {
  outcomes: 1,
  knowledge: 2,
  guardrails: 3,
  outputs: 4,
} as const satisfies Record<keyof typeof sectionLabels, WorkflowStepId>;

export function SingleShotPanel({
  prompt,
  interpretation,
  isInterpreting,
  error,
  onPromptChange,
  onInterpret,
  onSelectSplit,
  onReviewStep,
  onSwitchGuided,
}: SingleShotPanelProps) {
  const promptId = useId();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onInterpret();
  }

  return (
    <section className="single-shot-panel">
      <div className="single-shot-heading">
        <span className="single-shot-glyph">
          <Icon name="sparkles" size={19} />
        </span>
        <div>
          <strong>Describe the complete operating brief.</strong>
          <span>
            The interpreter prefills the same four governed sections. Nothing auto-confirms.
          </span>
        </div>
      </div>
      <form onSubmit={handleSubmit}>
        <label htmlFor={promptId}>
          Agent brief
          <textarea
            id={promptId}
            minLength={20}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Describe what the agent does, what it reads, what it may do, and how you will know it worked."
            value={prompt}
          />
        </label>
        <div className="single-shot-actions">
          <small>{prompt.length.toLocaleString()} / 12,000</small>
          <button
            className="primary-button"
            disabled={isInterpreting || prompt.trim().length < 20}
            type="submit"
          >
            {isInterpreting
              ? 'Interpreting…'
              : interpretation
                ? 'Interpret again'
                : 'Interpret brief'}
          </button>
        </div>
      </form>
      {error ? (
        <div className="single-shot-failure">
          <Notice tone="error">{error}</Notice>
          <button className="secondary-button" onClick={onSwitchGuided} type="button">
            Continue in Guided mode
          </button>
        </div>
      ) : null}
      {interpretation?.kind === 'split_required' ? (
        <div className="split-suggestion">
          <Notice>
            This brief describes multiple trigger/outcome pairs. Choose one scope for this agent.
          </Notice>
          <div>
            {interpretation.candidates.map((candidate) => (
              <button key={candidate.id} onClick={() => onSelectSplit(candidate.id)} type="button">
                <strong>{candidate.name}</strong>
                <span>{candidate.purpose}</span>
                <small>
                  {candidate.trigger} → {candidate.outcome}
                </small>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {interpretation?.kind === 'prefill' ? (
        <div className="interpretation-result">
          <header>
            <span className="page-kicker">INTERPRETATION READY · HUMAN REVIEW REQUIRED</span>
            <small>Expires {new Date(interpretation.expiresAt).toLocaleString()}</small>
          </header>
          {interpretation.authorityWarnings.length > 0 ? (
            <div className="authority-warnings">
              {interpretation.authorityWarnings.map((warning) => (
                <Notice key={`${warning.requestedAction}-${warning.disposition}`} tone="error">
                  <strong>{warning.disposition.replaceAll('_', ' ')}</strong> · {warning.message}
                </Notice>
              ))}
            </div>
          ) : null}
          <div className="interpretation-sections">
            {(Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>).map((section) => {
              const result = interpretation.sections[section];
              return (
                <button
                  className="interpretation-section"
                  data-confidence={result.confidence}
                  key={section}
                  onClick={() => onReviewStep(sectionSteps[section])}
                  type="button"
                >
                  <span>
                    <strong>{sectionLabels[section]}</strong>
                    <em>{result.confidence} confidence</em>
                  </span>
                  <small>
                    {result.unresolved.length > 0
                      ? `${result.unresolved.length} unresolved item${result.unresolved.length === 1 ? '' : 's'}`
                      : result.needsReview
                        ? 'Needs explicit review'
                        : 'Ready to review'}
                  </small>
                  <span aria-hidden="true">→</span>
                </button>
              );
            })}
          </div>
          {Object.values(interpretation.sections).flatMap((section) => section.unresolved).length >
          0 ? (
            <ul className="unresolved-list">
              {Object.values(interpretation.sections)
                .flatMap((section) => section.unresolved)
                .map((item) => (
                  <li key={item.id}>
                    <strong>{item.section}</strong>
                    <span>{item.message}</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
