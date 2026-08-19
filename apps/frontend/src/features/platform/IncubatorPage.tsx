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

const UUID_FRAGMENT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const OPAQUE_HEX_FRAGMENT = /\b[0-9a-f]{8,}\b/iu;

function readableWords(value: string) {
  const trimmed = value.trim();
  const words = (
    trimmed.includes(' ') ? trimmed.replace(/[._]+/gu, ' ') : trimmed.replace(/[._-]+/gu, ' ')
  ).replace(/\s+/gu, ' ');
  return words.length === 0 ? words : `${words[0]?.toLocaleUpperCase()}${words.slice(1)}`;
}

function safeCardLabel(value: string, fallback: string) {
  if (
    UUID_FRAGMENT.test(value) ||
    OPAQUE_HEX_FRAGMENT.test(value) ||
    /\b(?:human|service|system|test|worker)[.:/_-]/iu.test(value) ||
    /(?:[\\/]|\b[a-z][a-z0-9+.-]*:\/\/)/iu.test(value)
  ) {
    return fallback;
  }
  const readable = readableWords(value);
  return readable.length === 0 ? fallback : readable;
}

function safeCardCopy(value: string, fallback: string) {
  return safeCardLabel(value, fallback) === fallback
    ? fallback
    : value.trim().replace(/\s+/gu, ' ');
}

function improvementTarget(value: string) {
  const normalized = value.trim();
  if (UUID_FRAGMENT.test(normalized) || OPAQUE_HEX_FRAGMENT.test(normalized)) {
    return 'Governed definition';
  }
  const typedTarget = /^(Agent|Skill):([^@]+)@(.+)$/iu.exec(normalized);
  if (typedTarget) {
    return `${readableWords(typedTarget[2] ?? '')} · ${typedTarget[1]} version ${typedTarget[3]}`;
  }
  const successorTarget = /^([^@]+)@next$/iu.exec(normalized);
  if (successorTarget) return `${readableWords(successorTarget[1] ?? '')} · successor version`;
  return safeCardLabel(normalized, 'Governed definition');
}

function memorySubject(namespace: string) {
  return safeCardLabel(namespace, 'Governed memory proposal');
}

interface ProvenanceReference {
  label: string;
  value: string;
}

function TechnicalProvenance({
  references,
  sourceRunId = null,
}: {
  references: ProvenanceReference[];
  sourceRunId?: string | null;
}) {
  return (
    <details className="run-release-binding incubator-provenance">
      <summary>TECHNICAL PROVENANCE</summary>
      {sourceRunId ? (
        <Link
          className="incubator-source-link"
          to={`/operate?run=${sourceRunId}#run-${sourceRunId}`}
        >
          OPEN SOURCE RUN →
        </Link>
      ) : null}
      <dl>
        {references.map((reference, index) => (
          <div key={`${reference.label}:${reference.value}:${index}`}>
            <dt>{reference.label}</dt>
            <dd>
              <code>{reference.value}</code>
            </dd>
          </div>
        ))}
      </dl>
      <p>Exact identifiers are retained for audit and source inspection, not as card labels.</p>
    </details>
  );
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
            aria-label={`Replacement JSON for ${memorySubject(candidate.namespace)}`}
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
  const observationItems = observations.isError ? [] : (observations.data?.items ?? []);
  const improvementItems = improvements.isError ? [] : (improvements.data?.items ?? []);
  const memoryItems = memories.isError ? [] : (memories.data?.items ?? []);
  const mutationError = reviewImprovement.error ?? reviewMemory.error;

  async function decideImprovement(
    candidate: ImprovementCandidate,
    decision: 'incubate' | 'reject',
    rationale: string,
  ) {
    await reviewImprovement.mutateAsync({
      candidateId: candidate.id,
      value: { decision, rationale },
    });
    const candidateLabel = safeCardLabel(candidate.title, 'Governed improvement');
    setConfirmation(
      decision === 'incubate'
        ? `${candidateLabel} entered the governed incubator.`
        : `${candidateLabel} was rejected without modifying any definition.`,
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
        ? `${memorySubject(candidate.namespace)} was rejected and remains outside durable memory.`
        : `${memorySubject(candidate.namespace)} was accepted as an immutable memory record.`,
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

      {mutationError ? <Notice tone="error">{getErrorMessage(mutationError)}</Notice> : null}
      {confirmation ? <Notice tone="success">{confirmation}</Notice> : null}

      <div className="incubator-ledger">
        <section aria-busy={observations.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Observations</h2>
            <small>
              {observations.data !== undefined && !observations.isError
                ? observationItems.length
                : '—'}{' '}
              SIGNALS SHOWN · SUMMARY ONLY
            </small>
          </header>
          {observations.isError ? (
            <Notice tone="error">
              Observations unavailable. {getErrorMessage(observations.error)}
            </Notice>
          ) : null}
          <div className="run-list">
            {observations.isLoading ? (
              <div className="os-empty-state">Loading observations…</div>
            ) : null}
            {!observations.isLoading && !observations.isError && observationItems.length === 0 ? (
              <div className="os-empty-state">No governed observations recorded.</div>
            ) : null}
            {observationItems.map((observation) => (
              <article className="run-card" key={observation.id}>
                <header>
                  <div>
                    <h2>{safeCardLabel(observation.signalType, 'Operational observation')}</h2>
                    <p>
                      {safeCardCopy(
                        observation.summary,
                        'Operational observation retained for review.',
                      )}
                    </p>
                  </div>
                  <span className="os-status-chip">OBSERVED</span>
                </header>
                <div className="run-metadata">
                  <span>
                    EXECUTION LINEAGE ·{' '}
                    {observation.sourceRunId === null ? 'NOT LINKED' : 'RETAINED'}
                  </span>
                  <span>
                    OUTCOME EVIDENCE ·{' '}
                    {observation.sourceOutcomeId === null ? 'NOT RECORDED' : 'RETAINED'}
                  </span>
                  <span>PROVENANCE · RECORDER RETAINED IN AUDIT</span>
                  <span>TIME · {time(observation.observedAt)}</span>
                </div>
                <TechnicalProvenance
                  references={[
                    { label: 'SIGNAL KEY', value: observation.signalKey },
                    { label: 'OBSERVATION RECORD', value: observation.id },
                    ...(observation.sourceOutcomeId === null
                      ? []
                      : [{ label: 'SOURCE OUTCOME', value: observation.sourceOutcomeId }]),
                    ...(observation.sourceRunId === null
                      ? []
                      : [{ label: 'SOURCE RUN', value: observation.sourceRunId }]),
                  ]}
                  sourceRunId={observation.sourceRunId}
                />
              </article>
            ))}
          </div>
        </section>

        <section aria-busy={improvements.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Improvement candidates</h2>
            <small>HUMAN CURATION REQUIRED</small>
          </header>
          {improvements.isError ? (
            <Notice tone="error">
              Improvement candidates unavailable. {getErrorMessage(improvements.error)}
            </Notice>
          ) : null}
          <div className="run-list">
            {improvements.isLoading ? (
              <div className="os-empty-state">Loading candidates…</div>
            ) : null}
            {!improvements.isLoading && !improvements.isError && improvementItems.length === 0 ? (
              <div className="os-empty-state">No improvement candidates are awaiting curation.</div>
            ) : null}
            {improvementItems.map((candidate) => (
              <article className="run-card" key={candidate.id}>
                <header>
                  <div>
                    <h2>{safeCardLabel(candidate.title, 'Review a governed improvement')}</h2>
                    <p>Bounded proposal for {improvementTarget(candidate.proposedTarget)}.</p>
                  </div>
                  <span className="os-status-chip" data-state={candidate.state}>
                    {candidate.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>SOURCE · GOVERNED OBSERVATION RETAINED</span>
                  <span>EVIDENCE · {candidate.evidenceRefs.length} REFERENCES RETAINED</span>
                  <span>
                    CURATION · HUMAN DECISION {candidate.reviewedAt ? 'RECORDED' : 'PENDING'}
                  </span>
                  <span>CREATED · {time(candidate.createdAt)}</span>
                </div>
                <TechnicalProvenance
                  references={[
                    { label: 'CANDIDATE RECORD', value: candidate.id },
                    { label: 'SOURCE OBSERVATION', value: candidate.observationId },
                    ...candidate.evidenceRefs.map((value, index) => ({
                      label: `EVIDENCE ${String(index + 1).padStart(2, '0')}`,
                      value,
                    })),
                  ]}
                />
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
          {memories.isError ? (
            <Notice tone="error">
              Staged memory unavailable. {getErrorMessage(memories.error)}
            </Notice>
          ) : null}
          <div className="run-list">
            {memories.isLoading ? (
              <div className="os-empty-state">Loading staged memory…</div>
            ) : null}
            {!memories.isLoading && !memories.isError && memoryItems.length === 0 ? (
              <div className="os-empty-state">No durable-memory writes are staged.</div>
            ) : null}
            {memoryItems.map((candidate) => (
              <article className="run-card" key={candidate.id}>
                <header>
                  <div>
                    <h2>{memorySubject(candidate.namespace)}</h2>
                    <p>Contents withheld. Review the linked source run before deciding.</p>
                  </div>
                  <span className="os-status-chip" data-state={candidate.state}>
                    {candidate.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>SOURCE · EXECUTION LEDGER RETAINED</span>
                  <span>PROVENANCE · STAGING ACTOR RETAINED IN AUDIT</span>
                  <span>STAGED · {time(candidate.stagedAt)}</span>
                  <span>HUMAN REVIEW · {candidate.reviewedAt ? 'RECORDED' : 'PENDING'}</span>
                </div>
                <TechnicalProvenance
                  references={[
                    { label: 'MEMORY CANDIDATE', value: candidate.id },
                    { label: 'SOURCE RUN', value: candidate.sourceRunId },
                  ]}
                  sourceRunId={candidate.sourceRunId}
                />
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
