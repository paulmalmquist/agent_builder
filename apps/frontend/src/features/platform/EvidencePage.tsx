import { Link, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import {
  consoleActionCopy,
  consoleCriticalCopy,
  type ReleaseEvaluationGateResult,
} from '@agent-builder/contracts';
import {
  useMetrics,
  useOutcomes,
  useProductionChannel,
  useReleaseEvaluation,
  useRollbackRelease,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';
import { GovernedActionDialog } from './GovernedActionDialog';

function formatMetric(value: number, unit: string) {
  if (unit === 'usd') return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  if (unit === 'ms') return `${Math.round(value)} ms`;
  if (unit === 'ratio') return `${Math.round(value * 100)}%`;
  return `${value.toLocaleString()} ${unit}`;
}

const gateLabels: Record<ReleaseEvaluationGateResult['key'], string> = {
  dependency_closure: 'DEPENDENCY CLOSURE',
  schema_conformance: 'SCHEMA CONFORMANCE',
  citation_coverage: 'CITATION COVERAGE',
  unauthorized_actions: 'UNAUTHORIZED ACTIONS',
  mean_cost_usd: 'MEAN COST',
  p95_latency_ms: 'P95 LATENCY',
  mean_outcome_quality: 'MEAN OUTCOME QUALITY',
};

function humanizeLabel(value: string): string {
  const label = value
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
  return label.length === 0 ? 'Unlabeled' : `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function formatGateValue(gate: ReleaseEvaluationGateResult, value: number): string {
  if (gate.key === 'mean_cost_usd') return `$${value.toFixed(value < 1 ? 4 : 2)}`;
  if (gate.key === 'p95_latency_ms') return `${Math.round(value)} ms`;
  if (
    gate.key === 'dependency_closure' ||
    gate.key === 'schema_conformance' ||
    gate.key === 'citation_coverage' ||
    gate.key === 'mean_outcome_quality'
  ) {
    return `${Math.round(value * 100)}%`;
  }
  return value.toLocaleString();
}

function TechnicalProvenance({
  references,
}: {
  references: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <details className="run-release-binding evidence-provenance">
      <summary>TECHNICAL PROVENANCE</summary>
      <dl>
        {references.map(([label, value]) => (
          <div key={`${label}:${value}`}>
            <dt>{label}</dt>
            <dd>
              <code>{value}</code>
            </dd>
          </div>
        ))}
      </dl>
      <p>Exact identifiers are subordinate audit references, not user-facing names.</p>
    </details>
  );
}

export function EvidencePage() {
  const [searchParams] = useSearchParams();
  const channelKey = searchParams.get('channel')?.trim() || 'daily-operations';
  const evaluationId = searchParams.get('evaluation')?.trim() || null;
  const productionChannel = useProductionChannel(channelKey);
  const releaseEvaluation = useReleaseEvaluation(evaluationId);
  const outcomes = useOutcomes();
  const metrics = useMetrics();
  const rollback = useRollbackRelease(channelKey);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const outcomeItems = outcomes.isError ? [] : (outcomes.data?.items ?? []);
  const citedOutcomeCount = outcomeItems.filter((outcome) => outcome.citations.length > 0).length;
  const metricItems = metrics.isError ? [] : (metrics.data?.items ?? []);
  const rollbackReleaseId = productionChannel.data?.priorReleaseId ?? null;
  const channelLabel = humanizeLabel(channelKey);
  const productionChannelUnavailable = productionChannel.isError;
  const productionReleaseUnassigned =
    !productionChannel.isError &&
    (productionChannel.data === null || productionChannel.data?.currentReleaseId === null);

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Trace validated outcomes, operational measurements, and certification evidence back to the exact immutable release that produced them."
        kicker="OUTCOMES · METRICS · CERTIFICATION"
        stateDetail="PROVENANCE RETAINED · SCORES SERVER-OWNED"
        title="Evidence"
      />
      <InstrumentStrip
        readings={[
          {
            label: 'OUTCOMES SHOWN',
            value: outcomes.data !== undefined && !outcomes.isError ? outcomeItems.length : '—',
          },
          {
            label: 'METRICS SHOWN',
            value: metrics.data !== undefined && !metrics.isError ? metricItems.length : '—',
          },
          {
            label: 'CITED SHOWN',
            value: outcomes.data !== undefined && !outcomes.isError ? citedOutcomeCount : '—',
          },
          {
            label: 'UNRESOLVED SHOWN',
            value:
              outcomes.data !== undefined && !outcomes.isError
                ? outcomeItems.reduce((count, outcome) => count + outcome.unresolvedItems.length, 0)
                : '—',
          },
        ]}
      />
      {productionChannelUnavailable ? (
        <Notice tone="error">
          Production authority unavailable. {getErrorMessage(productionChannel.error)}
        </Notice>
      ) : null}
      {releaseEvaluation.error ? (
        <Notice tone="error">
          Evaluation evidence unavailable. {getErrorMessage(releaseEvaluation.error)}
        </Notice>
      ) : null}
      <div className="os-toolbar">
        <div>
          <p className="page-kicker">OPERATIONAL EVIDENCE LEDGER</p>
        </div>
        <Link className="secondary-button" to="/library">
          OPEN AGENT CERTIFICATION →
        </Link>
      </div>
      <section aria-busy={productionChannel.isLoading} className="os-panel release-evidence-panel">
        <header className="os-panel-heading">
          <h2>Production authority</h2>
          <small>CHANNEL · {channelKey.toUpperCase()}</small>
        </header>
        {productionChannel.isLoading ? (
          <div className="os-empty-state">Resolving production pointer…</div>
        ) : null}
        {productionReleaseUnassigned ? (
          <div className="release-authority-grid">
            <article className="evidence-card">
              <header>
                <div>
                  <h2>No release is assigned to {channelLabel}.</h2>
                  <p>
                    This is a normal unassigned channel. No production authority or release evidence
                    is implied.
                  </p>
                </div>
                <span className="os-status-chip" data-state="not_started">
                  unassigned
                </span>
              </header>
            </article>
          </div>
        ) : null}
        {!productionChannel.isError && productionChannel.data?.currentReleaseId ? (
          <div className="release-authority-grid">
            <article className="evidence-card">
              <header>
                <div>
                  <h2>Current production release</h2>
                  <p>{productionChannel.data.projectId ?? 'Default project authority'}</p>
                </div>
                <span
                  className="os-status-chip"
                  data-state={
                    productionChannel.data.currentReleaseId === null ? 'not_started' : 'succeeded'
                  }
                >
                  {productionChannel.data.currentReleaseId === null ? 'unassigned' : 'active'}
                </span>
              </header>
              <div className="run-metadata">
                <span>
                  RELEASE · {productionChannel.data.currentReleaseId?.slice(0, 8) ?? 'none'}
                </span>
                <span>
                  DIGEST · {productionChannel.data.currentReleaseDigest?.slice(0, 12) ?? 'none'}
                </span>
                <span>PRIOR · {productionChannel.data.priorReleaseId?.slice(0, 8) ?? 'none'}</span>
                <span>APPROVER · {productionChannel.data.promotedBy ?? 'none'}</span>
                <span>
                  DECIDED ·{' '}
                  {productionChannel.data.promotedAt === null
                    ? 'not promoted'
                    : new Date(productionChannel.data.promotedAt).toLocaleString()}
                </span>
              </div>
              {productionChannel.data.priorReleaseId ? (
                <button
                  className="secondary-button run-action"
                  onClick={() => setRollbackOpen(true)}
                  type="button"
                >
                  REVIEW ROLLBACK
                </button>
              ) : null}
            </article>
          </div>
        ) : null}
      </section>
      {evaluationId !== null ? (
        <section
          aria-busy={releaseEvaluation.isLoading}
          className="os-panel release-evidence-panel"
        >
          <header className="os-panel-heading">
            <h2>Deterministic contract evaluation</h2>
            <small>EVALUATION · {evaluationId.slice(0, 8)}</small>
          </header>
          {releaseEvaluation.isLoading ? (
            <div className="os-empty-state">Loading immutable evaluation evidence…</div>
          ) : null}
          {releaseEvaluation.data && !releaseEvaluation.isError ? (
            <>
              <div className="evidence-verdict">
                <span
                  aria-hidden="true"
                  className="evidence-verdict-mark"
                  data-verdict={releaseEvaluation.data.verdict}
                />
                <div>
                  <span className="page-kicker">VERDICT</span>
                  <h2>
                    {releaseEvaluation.data.verdict === 'passed'
                      ? 'This release passed every applicable evidence gate.'
                      : 'This release has evidence failures to resolve.'}
                  </h2>
                  <p>
                    {releaseEvaluation.data.gateResults.filter((gate) => gate.status === 'failed')
                      .length === 0
                      ? `${releaseEvaluation.data.gateResults.filter((gate) => gate.status === 'passed').length} gates passed · 0 regressed.`
                      : `${releaseEvaluation.data.gateResults.filter((gate) => gate.status === 'failed').length} gates failed · open technical evidence below.`}
                  </p>
                </div>
              </div>
              <div className="release-evaluation-summary">
                <span
                  className="os-status-chip"
                  data-state={releaseEvaluation.data.verdict === 'passed' ? 'succeeded' : 'failed'}
                >
                  {releaseEvaluation.data.verdict}
                </span>
                <span>EXECUTOR · {releaseEvaluation.data.executorKind}</span>
                <span>VERSION · {releaseEvaluation.data.executorVersion}</span>
                <span>MODE · {releaseEvaluation.data.evaluationMode}</span>
                <span>CORPUS · REV {releaseEvaluation.data.corpusVersion}</span>
                <span>RELEASE · {releaseEvaluation.data.releaseDigest.slice(0, 12)}</span>
                <span>HISTORY · {releaseEvaluation.data.historySnapshotDigest.slice(0, 12)}</span>
                <span>RUN LINEAGE · {releaseEvaluation.data.evidence.historyRunIds.length}</span>
              </div>
              <details className="evidence-technical-detail">
                <summary>
                  Inspect all gates and case assertions
                  <span>{releaseEvaluation.data.results.length} CASES</span>
                </summary>
                <div aria-label="Server-owned gate results" className="release-gate-grid">
                  {releaseEvaluation.data.gateResults.map((gate) => (
                    <article className="evidence-card" key={gate.key}>
                      <small>
                        {gateLabels[gate.key]} · {gate.evidenceSource.replaceAll('_', ' ')}
                      </small>
                      <strong className="metric-value">
                        {gate.status === 'not_applicable' || gate.measuredValue === null
                          ? 'N/A'
                          : formatGateValue(gate, gate.measuredValue)}
                      </strong>
                      <span
                        className="os-status-chip"
                        data-state={
                          gate.status === 'passed'
                            ? 'succeeded'
                            : gate.status === 'failed'
                              ? 'failed'
                              : 'not_started'
                        }
                      >
                        {gate.status.replaceAll('_', ' ')}
                      </span>
                      <p>
                        THRESHOLD · {gate.operator.toUpperCase()}{' '}
                        {formatGateValue(gate, gate.threshold)} · SAMPLES {gate.sampleSize}
                      </p>
                      <p>{gate.detail}</p>
                    </article>
                  ))}
                </div>
                <div className="release-case-list">
                  {releaseEvaluation.data.results.map((result) => (
                    <article className="evidence-card" key={result.caseKey}>
                      <header>
                        <div>
                          <h2>{result.caseKey.replaceAll('-', ' ')}</h2>
                          <p>Server-recorded deterministic assertions</p>
                        </div>
                        <span
                          className="os-status-chip"
                          data-state={result.passed ? 'succeeded' : 'failed'}
                        >
                          {result.passed ? 'passed' : 'failed'}
                        </span>
                      </header>
                      <ul className="release-assertion-list">
                        {result.assertions.map((assertion) => (
                          <li key={assertion.key}>
                            <span aria-hidden="true">{assertion.passed ? '●' : '○'}</span>
                            <div>
                              <strong>{assertion.key.replaceAll('_', ' ')}</strong>
                              <p>{assertion.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              </details>
              <p className="os-disclosure">{releaseEvaluation.data.disclaimer}</p>
            </>
          ) : null}
        </section>
      ) : (
        <section aria-label="Evaluation selection" className="os-panel release-evidence-panel">
          <div className="os-empty-state">
            <strong>No release evaluation selected.</strong>
            <span>
              Choose a governed evaluation from Agent Certification or open Attention when a release
              is awaiting review.
            </span>
            <div className="empty-state-actions">
              <Link className="secondary-button" to="/library">
                OPEN AGENT CERTIFICATION →
              </Link>
              <Link className="secondary-button" to="/attention">
                OPEN ATTENTION →
              </Link>
            </div>
          </div>
        </section>
      )}
      <div className="evidence-layout">
        <section aria-busy={outcomes.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Validated outcomes</h2>
            <small>OUTPUT PAYLOADS REMAIN CONTROLLED</small>
          </header>
          {outcomes.isError ? (
            <Notice tone="error">Outcomes unavailable. {getErrorMessage(outcomes.error)}</Notice>
          ) : null}
          {!outcomes.isLoading &&
          !outcomes.isError &&
          outcomeItems.length > 0 &&
          citedOutcomeCount === 0 ? (
            <Notice>
              <strong>NO RECORDED CITATION CHAINS.</strong> Every outcome in this loaded ledger has
              an empty citations array, so Paul OS has no governed source chain to show for these
              records. A resolved state or quality score does not prove cited evidence.
            </Notice>
          ) : null}
          <div className="evidence-list">
            {outcomes.isLoading ? <div className="os-empty-state">Loading outcomes…</div> : null}
            {!outcomes.isLoading && !outcomes.isError && outcomeItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No outcomes have been recorded.</strong>
                <span>Successful executions will write validated, provenance-bearing records.</span>
              </div>
            ) : null}
            {outcomeItems.map((outcome) => {
              const recordedAt = new Date(outcome.createdAt).toLocaleString();
              const citationLabel = outcome.citations.length === 1 ? 'CITATION' : 'CITATIONS';
              return (
                <article className="evidence-card" key={outcome.id}>
                  <header>
                    <div>
                      <h2 className="record-heading">
                        <span>Recorded outcome</span>
                        <small>
                          OUTCOME ·{' '}
                          {outcome.unresolvedItems.length === 0 ? 'resolved' : 'needs review'} ·{' '}
                          {outcome.citations.length} {citationLabel} · RECORDED {recordedAt}
                        </small>
                      </h2>
                      <p>Execution evidence · {recordedAt}</p>
                    </div>
                    <span
                      className="os-status-chip"
                      data-state={outcome.unresolvedItems.length === 0 ? 'succeeded' : 'running'}
                    >
                      {outcome.unresolvedItems.length === 0 ? 'resolved' : 'review'}
                    </span>
                  </header>
                  <div className="run-metadata">
                    <span>
                      QUALITY ·{' '}
                      {outcome.qualityScore === null ? 'not scored' : outcome.qualityScore}
                    </span>
                    <span>
                      CONFIDENCE ·{' '}
                      {outcome.confidence === null ? 'not reported' : outcome.confidence}
                    </span>
                    <span>CITATIONS · {outcome.citations.length}</span>
                    <span>UNRESOLVED · {outcome.unresolvedItems.length}</span>
                  </div>
                  <TechnicalProvenance
                    references={[
                      ['OUTCOME RECORD', outcome.id],
                      ['SOURCE RUN', outcome.runId],
                    ]}
                  />
                </article>
              );
            })}
          </div>
        </section>
        <section aria-busy={metrics.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Metric samples</h2>
            <small>QUALITY · LATENCY · TOKENS · COST</small>
          </header>
          {metrics.isError ? (
            <Notice tone="error">Metrics unavailable. {getErrorMessage(metrics.error)}</Notice>
          ) : null}
          <div className="evidence-list">
            {metrics.isLoading ? <div className="os-empty-state">Loading measurements…</div> : null}
            {!metrics.isLoading && !metrics.isError && metricItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No metrics have been observed.</strong>
                <span>Usage, latency, cost, and quality samples appear after execution.</span>
              </div>
            ) : null}
            {metricItems.map((metric) => (
              <article className="evidence-card" key={metric.id}>
                <header>
                  <div>
                    <h2>{humanizeLabel(metric.name)}</h2>
                    <p>{new Date(metric.observedAt).toLocaleString()}</p>
                  </div>
                  <span className="resource-kind">{humanizeLabel(metric.unit)}</span>
                </header>
                <strong className="metric-value">{formatMetric(metric.value, metric.unit)}</strong>
                <div className="run-metadata">
                  <span>
                    SOURCE · {metric.runId === null ? 'PLATFORM MEASUREMENT' : 'EXECUTION RUN'}
                  </span>
                </div>
                <TechnicalProvenance
                  references={[
                    ['METRIC RECORD', metric.id],
                    ...(metric.runId === null ? [] : ([['SOURCE RUN', metric.runId]] as const)),
                  ]}
                />
              </article>
            ))}
          </div>
        </section>
      </div>
      <p className="os-disclosure">
        Deterministic contract evidence validates declared fixtures and release composition; it does
        not measure semantic model quality. Semantic execution remains a separately stamped evidence
        mode.
      </p>
      {rollbackOpen && rollbackReleaseId ? (
        <GovernedActionDialog
          action={consoleActionCopy.rollbackRelease}
          defaultRationale="Restore the prior certified release after reviewing current production evidence."
          error={rollback.isError ? getErrorMessage(rollback.error) : null}
          introduction={consoleCriticalCopy.releaseRollback.introduction}
          isPending={rollback.isPending}
          kicker="PRODUCTION ROLLBACK"
          onClose={() => setRollbackOpen(false)}
          onConfirm={(rationale) =>
            rollback.mutate(
              { targetReleaseId: rollbackReleaseId, rationale },
              { onSuccess: () => setRollbackOpen(false) },
            )
          }
          rationaleRequired
          title={`Roll back ${channelKey}`}
        />
      ) : null}
    </main>
  );
}
