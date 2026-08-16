import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ImprovementCandidate, MemoryCandidate } from '@agent-builder/contracts';
import { getErrorMessage } from '../../api/client';
import {
  useImprovementCandidates,
  useMemoryCandidates,
  useObservations,
  useReviewImprovementCandidate,
  useReviewMemoryCandidate,
} from '../../api/hooks';
import { Notice } from '../../components/Notice';
import { SurfaceHeader } from './SurfaceHeader';

const stages = [
  {
    number: '01',
    title: 'Observe',
    description: 'Capture a repeated behavior, failure, override, or capability gap as evidence.',
    items: ['Source run retained', 'Sensitive payload excluded', 'Human attribution required'],
  },
  {
    number: '02',
    title: 'Shape',
    description: 'Turn evidence into a bounded candidate with purpose, impact, and ownership.',
    items: ['One capability per candidate', 'Authority stated explicitly', 'No silent mutation'],
  },
  {
    number: '03',
    title: 'Experiment',
    description: 'Create a mutable draft and test it before freezing a candidate version.',
    items: ['Development tools only', 'Revision history retained', 'Promotion remains human'],
  },
] as const;

function time(value: string) {
  return new Date(value).toLocaleString();
}

function shortId(value: string | null) {
  return value === null ? 'NONE' : value.slice(0, 8).toUpperCase();
}

function ImprovementReviewForm({
  isPending,
  onReview,
}: {
  isPending: boolean;
  onReview: (decision: 'incubate' | 'reject', rationale: string) => Promise<void>;
}) {
  const [decision, setDecision] = useState<'incubate' | 'reject'>('incubate');
  const [rationale, setRationale] = useState(
    'Advance this bounded proposal into human-led experimentation.',
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onReview(decision, rationale);
    } catch {
      // The shared mutation exposes its typed error through the page-level Notice.
    }
  }

  return (
    <form className="incubator-review-form" onSubmit={(event) => void submit(event)}>
      <label>
        <span>HUMAN DECISION</span>
        <select
          onChange={(event) => setDecision(event.target.value as 'incubate' | 'reject')}
          value={decision}
        >
          <option value="incubate">INCUBATE</option>
          <option value="reject">REJECT</option>
        </select>
      </label>
      <label>
        <span>RATIONALE</span>
        <textarea
          maxLength={2_000}
          minLength={10}
          onChange={(event) => setRationale(event.target.value)}
          required
          rows={3}
          value={rationale}
        />
      </label>
      <button className="secondary-button" disabled={isPending} type="submit">
        {isPending ? 'RECORDING…' : 'RECORD DECISION'}
      </button>
    </form>
  );
}

function MemoryReviewForm({
  candidate,
  isPending,
  onReview,
}: {
  candidate: MemoryCandidate;
  isPending: boolean;
  onReview: (
    decision: 'accept' | 'edit_accept' | 'reject',
    rationale: string,
    editedValue?: Record<string, unknown>,
  ) => Promise<void>;
}) {
  const [decision, setDecision] = useState<'accept' | 'edit_accept' | 'reject'>('accept');
  const [rationale, setRationale] = useState(
    'Accept this memory after reviewing its source run and provenance.',
  );
  const [editedJson, setEditedJson] = useState('{}');
  const [validationError, setValidationError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    if (decision !== 'edit_accept') {
      try {
        await onReview(decision, rationale);
      } catch {
        // The shared mutation exposes its typed error through the page-level Notice.
      }
      return;
    }
    let editedValue: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(editedJson);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('Edited memory must be a JSON object.');
      }
      editedValue = parsed as Record<string, unknown>;
    } catch (error) {
      setValidationError(getErrorMessage(error));
      return;
    }
    try {
      await onReview(decision, rationale, editedValue);
    } catch {
      // The shared mutation exposes its typed error through the page-level Notice.
    }
  }

  return (
    <form className="incubator-review-form" onSubmit={(event) => void submit(event)}>
      {validationError ? <Notice tone="error">{validationError}</Notice> : null}
      <label>
        <span>HUMAN DECISION</span>
        <select
          onChange={(event) => setDecision(event.target.value as typeof decision)}
          value={decision}
        >
          <option value="accept">ACCEPT AS PROPOSED</option>
          <option value="edit_accept">EDIT &amp; ACCEPT</option>
          <option value="reject">REJECT</option>
        </select>
      </label>
      {decision === 'edit_accept' ? (
        <label>
          <span>REPLACEMENT MEMORY · JSON OBJECT</span>
          <textarea
            aria-label={`Replacement JSON for ${candidate.namespace}`}
            onChange={(event) => setEditedJson(event.target.value)}
            required
            rows={5}
            spellCheck={false}
            value={editedJson}
          />
        </label>
      ) : null}
      <label>
        <span>RATIONALE</span>
        <textarea
          maxLength={2_000}
          minLength={10}
          onChange={(event) => setRationale(event.target.value)}
          required
          rows={3}
          value={rationale}
        />
      </label>
      <button className="secondary-button" disabled={isPending} type="submit">
        {isPending ? 'RECORDING…' : 'RECORD MEMORY DECISION'}
      </button>
    </form>
  );
}

export function IncubatorPage() {
  const observations = useObservations();
  const improvements = useImprovementCandidates();
  const memories = useMemoryCandidates();
  const reviewImprovement = useReviewImprovementCandidate();
  const reviewMemory = useReviewMemoryCandidate();
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const observationItems = observations.data?.items ?? [];
  const improvementItems = improvements.data?.items ?? [];
  const memoryItems = memories.data?.items ?? [];
  const combinedError =
    observations.error ??
    improvements.error ??
    memories.error ??
    reviewImprovement.error ??
    reviewMemory.error;

  async function decideImprovement(
    candidate: ImprovementCandidate,
    decision: 'incubate' | 'reject',
    rationale: string,
  ) {
    await reviewImprovement.mutateAsync({
      candidateId: candidate.id,
      value: { decision, rationale },
    });
    setConfirmation(
      decision === 'incubate'
        ? `${candidate.title} entered the governed incubator.`
        : `${candidate.title} was rejected without modifying any definition.`,
    );
  }

  async function decideMemory(
    candidate: MemoryCandidate,
    decision: 'accept' | 'edit_accept' | 'reject',
    rationale: string,
    editedValue?: Record<string, unknown>,
  ) {
    await reviewMemory.mutateAsync({
      candidateId: candidate.id,
      value:
        decision === 'edit_accept'
          ? { decision, rationale, editedValue: editedValue ?? {} }
          : { decision, rationale },
    });
    setConfirmation(
      decision === 'reject'
        ? `${candidate.namespace} was rejected and remains outside durable memory.`
        : `${candidate.namespace} was accepted as an immutable memory record.`,
    );
  }

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Convert observed work into reviewable improvements without allowing model-generated learning to rewrite promoted definitions."
        kicker="OBSERVATION → CANDIDATE → EXPERIMENT"
        stateDetail="HUMAN CURATION · NO AUTO-COMMIT"
        stateLabel="SAFE LEARNING BOUNDARY"
        title="Incubator"
      />
      <div className="incubator-flow">
        {stages.map((stage) => (
          <article className="incubator-stage" key={stage.number}>
            <span className="incubator-stage-number">{stage.number}</span>
            <h2>{stage.title}</h2>
            <p>{stage.description}</p>
            <ul>
              {stage.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>

      {combinedError ? <Notice tone="error">{getErrorMessage(combinedError)}</Notice> : null}
      {confirmation ? <Notice tone="success">{confirmation}</Notice> : null}

      <div className="incubator-ledger">
        <section aria-busy={observations.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Observations</h2>
            <small>{observationItems.length} SIGNALS · SUMMARY ONLY</small>
          </header>
          <div className="run-list">
            {observations.isLoading ? (
              <div className="os-empty-state">Loading observations…</div>
            ) : null}
            {!observations.isLoading && observationItems.length === 0 ? (
              <div className="os-empty-state">No governed observations recorded.</div>
            ) : null}
            {observationItems.map((observation) => (
              <article className="run-card" key={observation.id}>
                <header>
                  <div>
                    <h2>{observation.signalType.replaceAll('_', ' ')}</h2>
                    <p>{observation.summary}</p>
                  </div>
                  <span className="os-status-chip">OBSERVED</span>
                </header>
                <div className="run-metadata">
                  <span>SIGNAL · {observation.signalKey}</span>
                  <span>RUN · {shortId(observation.sourceRunId)}</span>
                  <span>OUTCOME · {shortId(observation.sourceOutcomeId)}</span>
                  <span>ACTOR · {observation.observedBy}</span>
                  <span>TIME · {time(observation.observedAt)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-busy={improvements.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Improvement candidates</h2>
            <small>HUMAN CURATION REQUIRED</small>
          </header>
          <div className="run-list">
            {improvements.isLoading ? (
              <div className="os-empty-state">Loading candidates…</div>
            ) : null}
            {!improvements.isLoading && improvementItems.length === 0 ? (
              <div className="os-empty-state">No improvement candidates are awaiting curation.</div>
            ) : null}
            {improvementItems.map((candidate) => (
              <article className="run-card" key={candidate.id}>
                <header>
                  <div>
                    <h2>{candidate.title}</h2>
                    <p>Bounded proposal for {candidate.proposedTarget}.</p>
                  </div>
                  <span className="os-status-chip" data-state={candidate.state}>
                    {candidate.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>OBSERVATION · {shortId(candidate.observationId)}</span>
                  <span>EVIDENCE REFERENCES · {candidate.evidenceRefs.length}</span>
                  <span>CREATED BY · {candidate.createdBy}</span>
                  <span>CREATED · {time(candidate.createdAt)}</span>
                </div>
                {candidate.state === 'proposed' ? (
                  <ImprovementReviewForm
                    isPending={
                      reviewImprovement.isPending &&
                      reviewImprovement.variables?.candidateId === candidate.id
                    }
                    onReview={(decision, rationale) =>
                      decideImprovement(candidate, decision, rationale)
                    }
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>

        <section aria-busy={memories.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Staged memory</h2>
            <small>PAYLOADS WITHHELD · HUMAN DECISION</small>
          </header>
          <div className="run-list">
            {memories.isLoading ? (
              <div className="os-empty-state">Loading staged memory…</div>
            ) : null}
            {!memories.isLoading && memoryItems.length === 0 ? (
              <div className="os-empty-state">No durable-memory writes are staged.</div>
            ) : null}
            {memoryItems.map((candidate) => (
              <article className="run-card" key={candidate.id}>
                <header>
                  <div>
                    <h2>{candidate.namespace}</h2>
                    <p>Contents withheld. Review the linked source run before deciding.</p>
                  </div>
                  <span className="os-status-chip" data-state={candidate.state}>
                    {candidate.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>SOURCE RUN · {shortId(candidate.sourceRunId)}</span>
                  <span>STAGED BY · {candidate.stagedBy}</span>
                  <span>STAGED · {time(candidate.stagedAt)}</span>
                  <span>REVIEWED BY · {candidate.reviewedBy ?? 'PENDING'}</span>
                </div>
                {candidate.state === 'staged' ? (
                  <MemoryReviewForm
                    candidate={candidate}
                    isPending={
                      reviewMemory.isPending && reviewMemory.variables?.candidateId === candidate.id
                    }
                    onReview={(decision, rationale, editedValue) =>
                      decideMemory(candidate, decision, rationale, editedValue)
                    }
                  />
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className="incubator-registry-link">
        <Link
          className="secondary-button"
          to="/registry?kind=ImprovementCandidate&lifecycle=experimental"
        >
          VIEW CANDIDATE DEFINITIONS →
        </Link>
      </div>
      <p className="os-disclosure">
        Paul OS may propose a manifest or Git patch here. It may not apply, commit, certify, or
        promote that change without an explicit human decision and evaluation evidence.
      </p>
    </main>
  );
}
