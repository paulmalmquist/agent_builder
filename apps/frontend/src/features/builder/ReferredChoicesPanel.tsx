import type {
  BuilderDecisionAction,
  BuilderIntakeResults,
  ReferredChoice,
} from '@agent-builder/contracts';
import { Icon } from '../../components/Icon';

export interface PendingBuilderDecision {
  action: BuilderDecisionAction;
  choice: ReferredChoice | null;
}

interface ReferredChoicesPanelProps {
  intakeId: string | null;
  isLoading: boolean;
  results: BuilderIntakeResults | undefined;
  onChoose: (decision: PendingBuilderDecision) => void;
}

function readableCapability(value: string): string {
  const separator = value.indexOf(':');
  return separator === -1 ? value : value.slice(separator + 1);
}

function successLabel(choice: ReferredChoice): string {
  if (choice.success.rate === null) return 'No measured runs yet';
  return `${Math.round(choice.success.rate * 100)}% success across ${choice.success.measuredRuns} runs`;
}

function costLabel(choice: ReferredChoice): string {
  if (choice.cost.usdPerRun === null) return 'Cost evidence unavailable';
  return `$${choice.cost.usdPerRun.toFixed(2)} per run · ${choice.cost.basis}`;
}

interface DeltaListProps {
  label: 'Has' | 'Lacks' | 'Offers';
  values: readonly string[];
}

function DeltaList({ label, values }: DeltaListProps) {
  return (
    <div className={`reuse-delta-group ${label.toLowerCase()}`}>
      <dt>{label}</dt>
      <dd>{values.length > 0 ? values.map(readableCapability).join(' · ') : 'Nothing material'}</dd>
    </div>
  );
}

interface ReferredChoiceCardProps {
  choice: ReferredChoice;
  onChoose: (decision: PendingBuilderDecision) => void;
}

function ReferredChoiceCard({ choice, onChoose }: ReferredChoiceCardProps) {
  const fallback = choice.match.mode === 'structured_only_fallback';
  return (
    <article className="reuse-choice-card">
      <div className="reuse-choice-heading">
        <span className="agent-icon">
          <Icon name="agent" size={25} />
        </span>
        <div>
          <div className="reuse-choice-title-line">
            <h3>{choice.name}</h3>
            <span className="match-chip">{Math.round(choice.match.score)}% MATCH</span>
            <span className="trust-chip">{choice.trustChip.label}</span>
          </div>
          <p>
            {Math.round(choice.match.score)}% match · {choice.version}
          </p>
          <span className={`match-method ${fallback ? 'fallback' : ''}`}>{choice.match.label}</span>
        </div>
      </div>

      <dl className="reuse-delta-list" aria-label={`Capability differences for ${choice.name}`}>
        <DeltaList label="Has" values={choice.delta.has} />
        <DeltaList label="Lacks" values={choice.delta.lacks} />
        <DeltaList label="Offers" values={choice.delta.offers} />
      </dl>

      <div className="reuse-provenance">
        <span>{choice.provenance.owner}</span>
        <span>{choice.provenance.department}</span>
        <span>
          {choice.deployment.active} active · {choice.deployment.total} total deployments
        </span>
        <span>{successLabel(choice)}</span>
        <span>{costLabel(choice)}</span>
      </div>

      {choice.knownLimitations.length > 0 ? (
        <details className="reuse-limitations">
          <summary>Known limitations</summary>
          <ul>
            {choice.knownLimitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="reuse-choice-actions">
        <button
          className="primary-button"
          onClick={() => onChoose({ action: 'use_as_is', choice })}
          type="button"
        >
          Use {choice.name} as-is
        </button>
        <div aria-label={`Adapt ${choice.name}`} className="reuse-adapt-actions" role="group">
          <button
            className="secondary-button"
            onClick={() => onChoose({ action: 'configure', choice })}
            type="button"
          >
            Configure overlay
          </button>
          <button
            className="secondary-button"
            onClick={() => onChoose({ action: 'extend', choice })}
            type="button"
          >
            Extend as fork
          </button>
        </div>
      </div>
    </article>
  );
}

export function ReferredChoicesPanel({
  intakeId,
  isLoading,
  results,
  onChoose,
}: ReferredChoicesPanelProps) {
  const choices = isLoading ? [] : (results?.referredChoices ?? []);
  const compositions = isLoading ? [] : (results?.compositionSuggestions ?? []);
  return (
    <section aria-busy={isLoading} aria-labelledby="referred-choices" className="suggestions-panel">
      <div className="panel-title">
        <span id="referred-choices">REFERRED CHOICES</span>
        <Icon name="draft" size={18} />
      </div>
      <div className="agent-list reuse-choice-list">
        {!intakeId ? (
          <div className="suggestion-state">
            Define the job first. Paul OS will compare certified agents before creating anything.
          </div>
        ) : null}
        {isLoading ? <div className="suggestion-state">Comparing certified agents…</div> : null}
        {intakeId && !isLoading && choices.length === 0 ? (
          <div className="suggestion-state">
            No certified agent covers this job. Start a new draft or review skill composition.
          </div>
        ) : null}
        {choices.map((choice) => (
          <ReferredChoiceCard choice={choice} key={choice.publicationId} onChoose={onChoose} />
        ))}
        {compositions.length > 0 ? (
          <details className="composition-suggestions">
            <summary>
              {Math.round(compositions[0]?.coveragePercent ?? 0)}% can be assembled from certified
              skills
            </summary>
            <ul>
              {compositions.map((composition) => (
                <li key={composition.key}>
                  {composition.skills.map((skill) => `${skill.name} ${skill.version}`).join(' + ')}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {intakeId && !isLoading ? (
          <button
            className="agent-row build-new"
            onClick={() => onChoose({ action: 'build_new', choice: null })}
            type="button"
          >
            <span className="new-icon">
              <Icon name="plus" size={23} />
            </span>
            <span className="agent-copy">
              <strong>None of these fit — Build a new agent</strong>
              <span>The reason becomes demand evidence when a strong match already exists.</span>
            </span>
            <span className="row-chevron">
              <Icon name="arrow" size={22} />
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
