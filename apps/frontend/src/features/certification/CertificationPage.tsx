import { useEffect, useMemo, useState } from 'react';
import {
  uuidSchema,
  type CertificationGateResult,
  type EvalCaseResult,
  type JsonValue,
} from '@agent-builder/contracts';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  useAgentDetail,
  useCertificationHistory,
  useCertificationRun,
  useFamilyVersions,
  usePromoteAgent,
  useStartCertification,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { PromotionDialog } from './PromotionDialog';

const gateLabels: Record<CertificationGateResult['gate'], string> = {
  factual_accuracy: 'Fixture agreement',
  citation_coverage: 'Citation coverage',
  unauthorized_actions: 'Unauthorized actions',
  champion_regression: 'Champion regression',
};

const operatorLabels: Record<CertificationGateResult['operator'], string> = {
  gte: '≥',
  lte: '≤',
  eq: '=',
};

function formattedScore(value: number | null, gate: CertificationGateResult['gate']) {
  if (value === null) return '—';
  if (gate === 'factual_accuracy' || gate === 'citation_coverage') {
    return `${Math.round(value * 1000) / 10}%`;
  }
  return String(Math.round(value * 1000) / 1000);
}

function jsonText(value: JsonValue | null): string {
  return value === null ? 'Not applicable' : JSON.stringify(value, null, 2);
}

function VersionPanel({
  label,
  name,
  version,
  manifestHash,
  status,
}: {
  label: string;
  name: string;
  version: number;
  manifestHash: string;
  status: string;
}) {
  return (
    <article className="cert-version-card">
      <span className="page-kicker">{label}</span>
      <span className={`status-chip ${status}`}>{status}</span>
      <h2>{name}</h2>
      <dl>
        <div>
          <dt>Version</dt>
          <dd>V{version}</dd>
        </div>
        <div>
          <dt>Manifest</dt>
          <dd title={manifestHash}>{manifestHash.slice(0, 12)}…</dd>
        </div>
      </dl>
    </article>
  );
}

function GateCard({
  gate,
  subjectOnly = false,
}: {
  gate: CertificationGateResult;
  subjectOnly?: boolean;
}) {
  return (
    <article className="gate-card" data-gate-status={gate.status}>
      <header>
        <span className="gate-lamp" />
        <strong>{gateLabels[gate.gate]}</strong>
      </header>
      <p>
        Threshold {operatorLabels[gate.operator]} {formattedScore(gate.threshold, gate.gate)}
      </p>
      {gate.status === 'not_applicable' ? (
        <div className="gate-not-applicable">NOT APPLICABLE</div>
      ) : (
        <>
          <div className={`gate-verdict ${gate.status}`}>
            {gate.status === 'passed' ? 'PASS' : 'FAIL'}
          </div>
          <dl>
            {subjectOnly ? (
              <div>
                <dt>Subject</dt>
                <dd>{formattedScore(gate.measuredValue, gate.gate)}</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>Champion</dt>
                  <dd>{formattedScore(gate.championScore, gate.gate)}</dd>
                </div>
                <div>
                  <dt>Challenger</dt>
                  <dd>{formattedScore(gate.challengerScore, gate.gate)}</dd>
                </div>
              </>
            )}
          </dl>
        </>
      )}
    </article>
  );
}

function CaseDiff({ result }: { result: EvalCaseResult }) {
  const championCitations = new Set(result.championCitations);
  const challengerCitations = new Set(result.challengerCitations);
  return (
    <article className="case-diff">
      <header>
        <div>
          <span className="page-kicker">PAIRED CASE</span>
          <h3>{result.caseName}</h3>
        </div>
        <span className={`status-chip ${result.passed ? 'passed' : 'failed'}`}>
          {result.passed ? 'passed' : 'failed'}
        </span>
      </header>
      <section>
        <h4>Identical input</h4>
        <pre>{jsonText(result.input)}</pre>
      </section>
      <div className="paired-output-grid">
        <section>
          <h4>Champion output</h4>
          <pre>{jsonText(result.championOutput)}</pre>
        </section>
        <section>
          <h4>Challenger output</h4>
          <pre>{jsonText(result.challengerOutput)}</pre>
        </section>
      </div>
      <section>
        <h4>Citation comparison</h4>
        <div className="citation-diff">
          {Array.from(new Set([...result.championCitations, ...result.challengerCitations])).map(
            (citation) => (
              <span
                data-challenger={challengerCitations.has(citation)}
                data-champion={championCitations.has(citation)}
                key={citation}
              >
                {citation}
              </span>
            ),
          )}
          {result.championCitations.length === 0 && result.challengerCitations.length === 0 ? (
            <small>No citations returned.</small>
          ) : null}
        </div>
      </section>
    </article>
  );
}

export function CertificationPage() {
  const { agentId: rawAgentId } = useParams<{ agentId: string }>();
  const parsedAgentId = uuidSchema.safeParse(rawAgentId);
  const agentId = parsedAgentId.success ? parsedAgentId.data : null;
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSelectedRunId = searchParams.get('run');
  const parsedRunId = uuidSchema.safeParse(rawSelectedRunId);
  const selectedRunId = parsedRunId.success ? parsedRunId.data : null;
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showPromotion, setShowPromotion] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const agent = useAgentDetail(agentId);
  const history = useCertificationHistory(agentId);
  const family = useFamilyVersions(agent.data?.familyId ?? null);
  const fallbackRunId = history.data?.items[0]?.id ?? null;
  const runId = agentId ? (selectedRunId ?? fallbackRunId) : null;
  const detail = useCertificationRun(runId);
  const startRun = useStartCertification(agentId);
  const promote = usePromoteAgent(agentId);
  const crossAgentRun = Boolean(
    detail.data && agentId && detail.data.run.agentVersionId !== agentId,
  );
  const runDetail = crossAgentRun ? undefined : detail.data;

  useEffect(() => {
    setSelectedCaseId(null);
  }, [runId]);

  const selectedResult = useMemo(() => {
    const items = runDetail?.results.items ?? [];
    return items.find((item) => item.id === selectedCaseId) ?? items[0] ?? null;
  }, [runDetail?.results.items, selectedCaseId]);

  function chooseRun(nextRunId: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('run', nextRunId);
      return next;
    });
  }

  function startCertification() {
    startRun.mutate(undefined, {
      onSuccess: (accepted) => {
        chooseRun(accepted.runId);
        setNotice('Certification queued against the current corpus and gate configuration.');
      },
    });
  }

  const participant = runDetail?.subject;
  const championSnapshot = runDetail?.champion ?? null;
  const familyChampion = family.data?.items.find((version) => version.isChampion) ?? null;
  const actionableBlocker = runDetail?.promotionEligibility.blockers.find(
    (blocker) => blocker.recommendedAction === 'recertify',
  );
  const run = runDetail?.run;
  const isChampionRecertification = run?.kind === 'champion_recertification';
  const subjectStatus = participant?.lifecycleStatus ?? agent.data?.status ?? null;
  const canRecertify =
    subjectStatus !== null && ['shadow', 'certified', 'active'].includes(subjectStatus);
  const executorHeading = run
    ? `${run.evaluationMode.replaceAll('_', ' ')} · ${run.executorKind.replaceAll('_', ' ')} · V${run.executorVersion}`
    : 'CERTIFICATION EVIDENCE';
  const persistentReturnSearch = useMemo(() => {
    const persistent = new URLSearchParams();
    (['spec', 'job', 'shadow', 'mode'] as const).forEach((key) => {
      const value = searchParams.get(key);
      if (value) persistent.set(key, value);
    });
    const value = persistent.toString();
    return value ? `?${value}` : '';
  }, [searchParams]);

  if (!parsedAgentId.success) {
    return (
      <main className="certification-page certification-invalid">
        <p className="page-kicker">CERTIFICATION ROUTE NOT FOUND</p>
        <h1>Malformed agent identifier.</h1>
        <p>No certification request was sent. Open a concrete version from the agent library.</p>
        <Link
          className="secondary-button certification-back"
          to={{ pathname: '/library', search: persistentReturnSearch }}
        >
          ← Agent library
        </Link>
      </main>
    );
  }

  return (
    <main className="certification-page">
      <header className="certification-heading">
        <div>
          <p className="page-kicker">{executorHeading.toUpperCase()}</p>
          <h1>
            {isChampionRecertification ? 'Champion Re-certification' : 'Champion / Challenger'}
          </h1>
          <p>
            {run?.evaluationMode === 'corpus_coverage'
              ? 'Scores measure deterministic corpus agreement, not live semantic answer quality.'
              : 'Scores were produced by the executor recorded on this immutable run.'}
          </p>
        </div>
        <Link className="secondary-button certification-back" to="/library">
          ← Agent library
        </Link>
      </header>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {agent.isError || history.isError || detail.isError ? (
        <Notice tone="error">
          {getErrorMessage(agent.error ?? history.error ?? detail.error)}
        </Notice>
      ) : null}
      {crossAgentRun ? (
        <Notice tone="error">
          The selected certification run does not belong to this agent version. No evidence or
          promotion controls were displayed.
        </Notice>
      ) : null}
      {startRun.isError ? <Notice tone="error">{getErrorMessage(startRun.error)}</Notice> : null}

      {runDetail ? (
        <section className="certification-verdict-first" aria-label="Certification verdict">
          <span
            aria-hidden="true"
            className="evidence-verdict-mark"
            data-verdict={runDetail.run.state === 'passed' ? 'passed' : 'failed'}
          />
          <div>
            <span className="page-kicker">VERDICT · {runDetail.run.state.toUpperCase()}</span>
            <h2>
              {runDetail.run.state === 'passed'
                ? 'This challenger passed every applicable certification gate.'
                : runDetail.run.state === 'failed'
                  ? 'This challenger has certification failures to resolve.'
                  : 'Certification evidence is still being produced.'}
            </h2>
            <p>
              {runDetail.gates.filter((gate) => gate.status === 'passed').length} gates passed ·{' '}
              {runDetail.gates.filter((gate) => gate.status === 'failed').length} failed ·{' '}
              {runDetail.run.caseCounts.passed}/{runDetail.run.caseCounts.total} cases passed.
            </p>
            <small>
              {runDetail.run.evaluationMode === 'corpus_coverage'
                ? 'Coverage certification measures fixture agreement, not semantic answer quality.'
                : `Evidence was produced by ${runDetail.run.executorKind} ${runDetail.run.executorVersion}.`}
            </small>
          </div>
        </section>
      ) : null}

      <section
        aria-label="Certification participants"
        className="certification-participants"
        data-subject-only={isChampionRecertification}
      >
        {isChampionRecertification && participant ? (
          <VersionPanel
            label="CHAMPION SUBJECT · NIGHTLY RE-CERTIFICATION"
            manifestHash={participant.manifestHash}
            name={participant.name}
            status={participant.lifecycleStatus}
            version={participant.versionNumber}
          />
        ) : championSnapshot ? (
          <VersionPanel
            label="CHAMPION"
            manifestHash={championSnapshot.manifestHash}
            name={championSnapshot.name}
            status={championSnapshot.lifecycleStatus}
            version={championSnapshot.versionNumber}
          />
        ) : familyChampion ? (
          <VersionPanel
            label="CHAMPION"
            manifestHash={familyChampion.manifestHash ?? 'manifest pending'}
            name={familyChampion.name}
            status={familyChampion.status}
            version={familyChampion.versionNumber}
          />
        ) : (
          <article className="cert-version-card empty">
            <span className="page-kicker">CHAMPION</span>
            <h2>First certification</h2>
            <p>No promoted champion exists for this family.</p>
          </article>
        )}
        {!isChampionRecertification ? (
          <div aria-hidden="true" className="versus-marker">
            VS
          </div>
        ) : null}
        {!isChampionRecertification && participant ? (
          <VersionPanel
            label="CHALLENGER"
            manifestHash={participant.manifestHash}
            name={participant.name}
            status={participant.lifecycleStatus}
            version={participant.versionNumber}
          />
        ) : !isChampionRecertification && agent.data ? (
          <VersionPanel
            label="CHALLENGER"
            manifestHash={agent.data.manifestHash ?? 'manifest pending'}
            name={agent.data.name}
            status={agent.data.status}
            version={agent.data.versionNumber}
          />
        ) : !isChampionRecertification ? (
          <article className="cert-version-card empty">
            <p>Loading challenger…</p>
          </article>
        ) : null}
      </section>

      <section className="certification-toolbar">
        <div>
          <span className="page-kicker">RUN CONTROL</span>
          <strong>{runDetail?.run.message ?? 'No certification evidence recorded yet.'}</strong>
        </div>
        <button
          className="primary-button"
          disabled={startRun.isPending || !canRecertify}
          onClick={startCertification}
          type="button"
        >
          <Icon name="sparkles" size={17} />
          {startRun.isPending
            ? 'Queueing…'
            : history.data?.items.length
              ? 'Re-certify'
              : 'Start certification'}
        </button>
      </section>

      {run ? (
        <dl className="certification-run-metadata">
          <div>
            <dt>Corpus</dt>
            <dd>V{run.corpusVersion}</dd>
          </div>
          <div>
            <dt>Gate config</dt>
            <dd>V{run.gateConfigVersion}</dd>
          </div>
          <div>
            <dt>Generator</dt>
            <dd>V{run.generatorVersion}</dd>
          </div>
          <div>
            <dt>Executor</dt>
            <dd>
              {run.executorKind} V{run.executorVersion}
            </dd>
          </div>
          <div>
            <dt>Mode</dt>
            <dd>{run.evaluationMode.replaceAll('_', ' ')}</dd>
          </div>
          <div>
            <dt>Cases</dt>
            <dd>
              {run.caseCounts.passed} passed · {run.caseCounts.failed} failed ·{' '}
              {run.caseCounts.total} total
            </dd>
          </div>
          <div>
            <dt>Promotion evidence fresh until</dt>
            <dd>
              {runDetail?.promotionEligibility.freshUntil
                ? new Date(runDetail.promotionEligibility.freshUntil).toLocaleString()
                : 'Not eligible'}
            </dd>
          </div>
        </dl>
      ) : null}

      {history.data?.items.length ? (
        <section className="run-history" aria-label="Certification run history">
          <span className="page-kicker">RUN HISTORY</span>
          <div>
            {history.data.items.map((run) => (
              <button
                aria-pressed={run.id === runId}
                key={run.id}
                onClick={() => chooseRun(run.id)}
                type="button"
              >
                <span className={`run-state ${run.state}`}>{run.state}</span>
                <strong>{new Date(run.requestedAt).toLocaleDateString()}</strong>
                <small>
                  Corpus {run.corpusVersion} · {run.resultsAvailability.replaceAll('_', ' ')}
                </small>
                <small>
                  {run.caseCounts.passed}/{run.caseCounts.total} cases passed
                </small>
              </button>
            ))}
          </div>
          {history.hasNextPage ? (
            <button
              className="secondary-button history-load-more"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
              type="button"
            >
              {history.isFetchingNextPage ? 'Loading run history…' : 'Load more runs'}
            </button>
          ) : null}
        </section>
      ) : null}

      {runDetail ? (
        <>
          <section className="gate-scoreboard" aria-label="Certification gates">
            {runDetail.gates.map((gate) => (
              <GateCard gate={gate} key={gate.gate} subjectOnly={isChampionRecertification} />
            ))}
          </section>

          {runDetail.run.resultsAvailability === 'summary_only' ? (
            <Notice>
              This historical run retains its verdict and gate summary. Paired outputs were pruned
              under the non-evidence retention policy. {runDetail.run.caseCounts.passed} of{' '}
              {runDetail.run.caseCounts.total} cases passed.
            </Notice>
          ) : runDetail.results.items.length > 0 ? (
            <section className="case-review">
              <nav aria-label="Certification cases" className="case-list">
                <span className="page-kicker">FAILING CASES FIRST</span>
                {runDetail.results.items.map((result) => (
                  <button
                    aria-pressed={result.id === selectedResult?.id}
                    key={result.id}
                    onClick={() => setSelectedCaseId(result.id)}
                    type="button"
                  >
                    <span className={`case-indicator ${result.passed ? 'passed' : 'failed'}`} />
                    <span>
                      <strong>{result.caseName}</strong>
                      <small>{result.tags.join(' · ')}</small>
                    </span>
                  </button>
                ))}
                {detail.hasNextPage ? (
                  <button
                    className="secondary-button case-load-more"
                    disabled={detail.isFetchingNextPage}
                    onClick={() => void detail.fetchNextPage()}
                    type="button"
                  >
                    {detail.isFetchingNextPage ? 'Loading cases…' : 'Load more cases'}
                  </button>
                ) : null}
              </nav>
              {selectedResult ? <CaseDiff result={selectedResult} /> : null}
            </section>
          ) : (
            <p className="certification-empty">
              Case-level evidence will appear as the run executes.
            </p>
          )}

          {!isChampionRecertification ? (
            <section className="promotion-panel">
              <div>
                <span className="page-kicker">HUMAN PROMOTION DECISION</span>
                {runDetail.promotionEligibility.eligible ? (
                  <strong>Passing, current evidence is ready for approval.</strong>
                ) : (
                  <strong>Promotion is blocked by the evidence record.</strong>
                )}
                {runDetail.promotionEligibility.blockers.map((blocker) => (
                  <p key={blocker.code}>
                    <code>{blocker.code}</code> {blocker.message}
                  </p>
                ))}
              </div>
              {actionableBlocker && canRecertify ? (
                <button
                  className="secondary-button"
                  disabled={startRun.isPending}
                  onClick={startCertification}
                  type="button"
                >
                  Re-certify against current corpus
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={!runDetail.promotionEligibility.eligible || !canRecertify}
                  onClick={() => setShowPromotion(true)}
                  type="button"
                >
                  Promote challenger
                </button>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {showPromotion && runDetail ? (
        <PromotionDialog
          agentName={runDetail.subject.name}
          error={promote.isError ? getErrorMessage(promote.error) : null}
          isPromoting={promote.isPending}
          onClose={() => setShowPromotion(false)}
          onPromote={(rationale) => {
            const promotionRunId = runDetail?.run.id;
            if (!promotionRunId) return;
            promote.mutate(
              { runId: promotionRunId, rationale },
              {
                onSuccess: () => {
                  setShowPromotion(false);
                  setNotice('Promotion recorded. The challenger is now the active champion.');
                },
              },
            );
          }}
        />
      ) : null}
    </main>
  );
}
