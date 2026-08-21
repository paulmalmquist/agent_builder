import { useState, type FormEvent } from 'react';
import {
  consoleActionCopy,
  consoleCriticalCopy,
  type AutomationSchedule,
  type AuthorityGrant,
  type ExecutionRun,
  uuidSchema,
} from '@agent-builder/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import {
  useApproveExecutionRun,
  useAutomationSchedules,
  useAuthorityGrants,
  useCancelExecutionRun,
  useExecutionRun,
  useExecutionRuns,
  useRevokeAuthorityGrant,
  useUpdateAutomationScheduleState,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { featureFlags } from '../../config/feature-flags';
import { ApprovalDialog } from './ApprovalDialog';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';
import { GovernedActionDialog } from './GovernedActionDialog';

function money(value: number | null) {
  return value === null ? '—' : `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function actualCost(value: number | null) {
  return value === null ? 'NOT RECORDED' : money(value);
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not started';
}

function elapsed(start: string | null, end: string | null) {
  if (start === null || end === null) return 'Not started';
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function subjectName(subject: ExecutionRun['entrySubject']) {
  return subject?.name ?? 'Execution subject unavailable';
}

function subjectDescriptor(subject: ExecutionRun['entrySubject']) {
  return subject === null
    ? 'Exact entry subject unavailable'
    : `${subject.name} · ${subject.kind.replaceAll('_', ' ')} · version ${subject.version}`;
}

function siblingTitle(base: string, index: number, total: number): string {
  return total > 1 ? `${base} · ${index + 1} of ${total}` : base;
}

function ExactReleaseBinding({
  authoredName = null,
  entryResourceVersionId,
  releaseDigest,
  releaseId,
  subject = null,
}: {
  authoredName?: string | null;
  entryResourceVersionId: string;
  releaseDigest: string;
  releaseId: string;
  subject?: ExecutionRun['entrySubject'];
}) {
  return (
    <details className="run-release-binding">
      <summary>EXACT RELEASE REFERENCE</summary>
      <dl>
        {authoredName ? (
          <div>
            <dt>AUTHORED SCHEDULE NAME</dt>
            <dd>{authoredName}</dd>
          </div>
        ) : null}
        {subject ? (
          <div>
            <dt>ENTRY SUBJECT</dt>
            <dd>{subjectDescriptor(subject)}</dd>
          </div>
        ) : null}
        <div>
          <dt>RELEASE DIGEST</dt>
          <dd>
            <code>{releaseDigest}</code>
          </dd>
        </div>
        <div>
          <dt>RELEASE RECORD</dt>
          <dd>
            <code>{releaseId}</code>
          </dd>
        </div>
        <div>
          <dt>ENTRY RESOURCE VERSION</dt>
          <dd>
            <code>{entryResourceVersionId}</code>
          </dd>
        </div>
      </dl>
      <p>Exact identifiers are subordinate audit references, not user-facing names.</p>
    </details>
  );
}

function runMessage(run: ExecutionRun) {
  if (run.state === 'failed' && /^execution failed$/iu.test(run.message.trim())) {
    return 'No specific failure reason was recorded.';
  }
  if (run.state === 'cancelled' && /^cancelled$/iu.test(run.message.trim())) {
    return 'The execution was cancelled before a usable outcome was recorded.';
  }
  return run.message;
}

function PluginScopeSummary({ scopes }: { scopes: ExecutionRun['requiredPluginScopes'] }) {
  if (scopes.length === 0) return null;
  return (
    <div className="run-plugin-scopes">
      <strong>PLUGIN ACCESS</strong>
      <ul>
        {scopes.map((scope) => (
          <li key={`${scope.installationId}:${scope.tool}`}>
            <span>{scope.scopeDescription}</span>
            <small>
              {scope.effect} · {scope.executionPlacement.replace('_', ' ')}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunFlightRecorder({ run }: { run: ExecutionRun }) {
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(run.state);
  const runSubjectName = subjectName(run.entrySubject);
  return (
    <details className="run-flight-recorder">
      <summary>
        <span>FLIGHT RECORDER</span>
        <span>
          {run.progress}% · COST {actualCost(run.actualCostUsd)}
        </span>
      </summary>
      <ol aria-label={`${runSubjectName} execution phases`}>
        <li data-phase-state="complete">
          <span>01</span>
          <div>
            <strong>REQUEST</strong>
            <small>{time(run.createdAt)}</small>
          </div>
          <em>ACCEPTED</em>
        </li>
        <li data-phase-state={run.authorityGrantId ? 'complete' : 'waiting'}>
          <span>02</span>
          <div>
            <strong>AUTHORITY</strong>
            <small>
              {run.requiredToolScopes.length + run.requiredPluginScopes.length} bounded scopes
            </small>
          </div>
          <em>
            {run.authorityGrantId
              ? 'BOUND'
              : run.state === 'awaiting_approval'
                ? 'WAITING'
                : 'NOT BOUND'}
          </em>
        </li>
        <li data-phase-state={run.startedAt ? (terminal ? 'complete' : 'active') : 'waiting'}>
          <span>03</span>
          <div>
            <strong>EXECUTION</strong>
            <small>{elapsed(run.startedAt, run.finishedAt ?? run.updatedAt)}</small>
          </div>
          <em>{run.startedAt ? (terminal ? 'COMPLETE' : 'IN FLIGHT') : 'NOT STARTED'}</em>
        </li>
        <li
          data-phase-state={
            terminal ? (run.state === 'succeeded' ? 'complete' : 'stopped') : 'waiting'
          }
        >
          <span>04</span>
          <div>
            <strong>OUTCOME</strong>
            <small>{run.finishedAt ? time(run.finishedAt) : run.message}</small>
          </div>
          <em>{terminal ? run.state.replaceAll('_', ' ').toUpperCase() : 'PENDING'}</em>
        </li>
      </ol>
      <footer>
        <span>ACTUAL COST · {actualCost(run.actualCostUsd)}</span>
        <span>CEILING · {money(run.maxEstimatedCostUsd)}</span>
        <span>ATTEMPTS · {run.attempts}</span>
      </footer>
    </details>
  );
}

function RunContextInspector({ run }: { run: ExecutionRun }) {
  return (
    <details className="run-flight-recorder run-context-inspector">
      <summary>
        <span>CONTEXT INSPECTOR</span>
        <span>{run.contextEstimatedTokens.toLocaleString()} EST. TOKENS</span>
      </summary>
      <div className="run-context-summary">
        <dl>
          <div>
            <dt>CLASSIFICATION</dt>
            <dd>{run.contextClassification}</dd>
          </div>
          <div>
            <dt>INPUT KEYS</dt>
            <dd>{Object.keys(run.input).length}</dd>
          </div>
          <div>
            <dt>PROVENANCE SOURCES</dt>
            <dd>{run.contextProvenance.length}</dd>
          </div>
        </dl>
        <ul aria-label="Context provenance summary">
          {run.contextProvenance.map((source, index) => (
            <li key={`${source.source}:${source.classification}:${index}`}>
              <strong>{source.source.replaceAll('_', ' ')}</strong>
              <span>
                {source.classification} · {source.tokenContribution.toLocaleString()} tokens
              </span>
            </li>
          ))}
        </ul>
        <h3>Recorded run input</h3>
        <pre>{JSON.stringify(run.input, null, 2)}</pre>
        <p>
          This is the durable input and provenance summary. The assembled provider prompt is not
          exposed by the current API, so Paul OS does not claim this is the complete model context.
        </p>
      </div>
    </details>
  );
}

function ScheduleStateControl({
  schedule,
  isPending,
  onUpdate,
}: {
  schedule: AutomationSchedule;
  isPending: boolean;
  onUpdate: (state: AutomationSchedule['state'], rationale: string) => void;
}) {
  const target = schedule.state === 'active' ? 'paused' : 'active';
  const [rationale, setRationale] = useState(
    target === 'paused'
      ? 'Pause this schedule while its operating context is reviewed.'
      : 'Resume this reviewed schedule under its existing bounded authority.',
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onUpdate(target, rationale);
  }

  return (
    <form className="schedule-state-form" onSubmit={submit}>
      <label>
        <span className="sr-only">
          Rationale for changing {schedule.entrySubject?.name ?? 'automation'} schedule
        </span>
        <input
          maxLength={2_000}
          minLength={10}
          onChange={(event) => setRationale(event.target.value)}
          required
          value={rationale}
        />
      </label>
      <button className="secondary-button" disabled={isPending} type="submit">
        {target === 'paused' ? 'PAUSE SCHEDULE' : 'RESUME SCHEDULE'}
      </button>
    </form>
  );
}

export function RunsPage() {
  const [searchParams] = useSearchParams();
  const requestedRunReference = searchParams.get('run')?.trim() ?? null;
  const requestedRunResult = uuidSchema.safeParse(requestedRunReference);
  const requestedRunId = requestedRunResult.success ? requestedRunResult.data : null;
  const runs = useExecutionRuns({ limit: 50 });
  const requestedRun = useExecutionRun(requestedRunId);
  const grants = useAuthorityGrants({ limit: 50 });
  const schedules = useAutomationSchedules();
  const approve = useApproveExecutionRun();
  const cancel = useCancelExecutionRun();
  const revoke = useRevokeAuthorityGrant();
  const updateSchedule = useUpdateAutomationScheduleState();
  const [approvalRun, setApprovalRun] = useState<ExecutionRun | null>(null);
  const [revocationGrant, setRevocationGrant] = useState<AuthorityGrant | null>(null);
  const listedRunItems = runs.isError ? [] : (runs.data?.items ?? []);
  const runItems =
    requestedRun.data && !listedRunItems.some((run) => run.id === requestedRun.data.id)
      ? [requestedRun.data, ...listedRunItems]
      : listedRunItems;
  const grantItems = grants.isError ? [] : (grants.data?.items ?? []);
  const scheduleItems = schedules.isError ? [] : (schedules.data?.items ?? []);
  const mutationError = cancel.error ?? revoke.error ?? updateSchedule.error;

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Move between what is allowed, what is scheduled, and what happened without losing the exact release, grant, or context boundary."
        kicker="RUNS · AUTHORITY · AUTOMATION"
        stateDetail="LEASED RUNS · FAIL-CLOSED GRANTS"
        title="Operate"
      />
      <nav aria-label="Operate views" className="section-tabs">
        <a href="#operate-runs">RUNS</a>
        <a href="#operate-authority">AUTHORITY</a>
        <a href="#operate-schedules">SCHEDULES</a>
        <Link to="/attention">APPROVALS ↗</Link>
        {featureFlags.visualSurfacesEnabled ? (
          <>
            <Link to="/observatory">FLOW VIEW ↗</Link>
            <Link to="/wall">SIGNAL WALL ↗</Link>
          </>
        ) : null}
      </nav>
      <InstrumentStrip
        readings={[
          {
            label: 'CURRENT · AWAITING APPROVAL',
            value:
              runs.data !== undefined && !runs.isError
                ? runs.data.countsByState.awaiting_approval
                : '—',
          },
          {
            label: 'CURRENT · QUEUED OR RUNNING',
            value:
              runs.data !== undefined && !runs.isError
                ? runs.data.countsByState.queued + runs.data.countsByState.running
                : '—',
          },
          {
            label: 'CURRENT · ACTIVE GRANTS',
            value: grants.data !== undefined && !grants.isError ? grants.data.activeTotal : '—',
          },
          {
            label: 'CURRENT · ACTIVE SCHEDULES',
            value:
              schedules.data !== undefined && !schedules.isError ? schedules.data.activeTotal : '—',
          },
        ]}
      />
      {mutationError ? <Notice tone="error">{getErrorMessage(mutationError)}</Notice> : null}
      {requestedRunReference !== null && !requestedRunResult.success ? (
        <Notice tone="error">The requested source run reference is invalid.</Notice>
      ) : null}
      {requestedRunId !== null && requestedRun.isError ? (
        <Notice tone="error">
          Requested source run unavailable. {getErrorMessage(requestedRun.error)}
        </Notice>
      ) : null}
      <div className="runs-layout">
        <section aria-busy={runs.isLoading} className="os-panel" id="operate-runs">
          <header className="os-panel-heading">
            <h2>Execution ledger</h2>
            <small>CURRENT + HISTORY · NEWEST FIRST</small>
          </header>
          {runs.isError ? (
            <Notice tone="error">
              Execution ledger unavailable. {getErrorMessage(runs.error)}
            </Notice>
          ) : null}
          <div className="run-list">
            {runs.isLoading ? <div className="os-empty-state">Loading durable runs…</div> : null}
            {!runs.isLoading && !runs.isError && runItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No execution runs yet.</strong>
                <span>Imported releases appear here after an execution is requested.</span>
              </div>
            ) : null}
            {runItems.map((run) => (
              <article
                className="run-card"
                data-source-target={run.id === requestedRunId ? 'true' : undefined}
                id={`run-${run.id}`}
                key={run.id}
              >
                <header>
                  <div>
                    <h2 className="record-heading">
                      <span>{subjectName(run.entrySubject)}</span>
                      <small>
                        RUN · {run.state.replaceAll('_', ' ')} · REQUESTED {time(run.createdAt)}
                      </small>
                    </h2>
                    <p>{runMessage(run)}</p>
                  </div>
                  <span className="os-status-chip" data-state={run.state}>
                    {run.state.replaceAll('_', ' ')}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>ENTRY · {subjectDescriptor(run.entrySubject)}</span>
                  <span>RELEASE BINDING · EXACT IMMUTABLE VERSION</span>
                  <span>
                    PROVIDER · {run.providerKind} / {run.model}
                  </span>
                  <span>
                    COST · {actualCost(run.actualCostUsd)} / {money(run.maxEstimatedCostUsd)}{' '}
                    ceiling
                  </span>
                  <span>START · {time(run.startedAt)}</span>
                </div>
                <ExactReleaseBinding
                  entryResourceVersionId={run.entryResourceVersionId ?? 'UNRESOLVED'}
                  releaseDigest={run.releaseDigest}
                  releaseId={run.releaseId}
                  subject={run.entrySubject}
                />
                <PluginScopeSummary scopes={run.requiredPluginScopes} />
                <RunFlightRecorder run={run} />
                <RunContextInspector run={run} />
                {run.state === 'awaiting_approval' ? (
                  <button
                    className="primary-button run-action"
                    onClick={() => setApprovalRun(run)}
                    type="button"
                  >
                    REVIEW AUTHORITY REQUEST
                  </button>
                ) : null}
                {run.state === 'queued' ||
                run.state === 'running' ||
                run.state === 'paused_budget' ? (
                  <button
                    className="secondary-button run-action"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(run.id)}
                    type="button"
                  >
                    {run.state === 'paused_budget' ? 'CANCEL PAUSED RUN' : 'CANCEL RUN'}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
        <section aria-busy={grants.isLoading} className="os-panel" id="operate-authority">
          <header className="os-panel-heading">
            <h2>Authority envelopes</h2>
            <small>CURRENT + HISTORY · EXACT RELEASE DIGESTS</small>
          </header>
          {grants.isError ? (
            <Notice tone="error">
              Authority envelopes unavailable. {getErrorMessage(grants.error)}
            </Notice>
          ) : null}
          <div className="approval-list">
            {grants.isLoading ? (
              <div className="os-empty-state">Loading authority grants…</div>
            ) : null}
            {!grants.isLoading && !grants.isError && grantItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No authority has been granted.</strong>
                <span>The first production-shaped run must receive a human decision.</span>
              </div>
            ) : null}
            {grantItems.map((grant, index) => (
              <article className="approval-card" key={grant.id}>
                <header>
                  <div>
                    <h2 className="record-heading">
                      <span>
                        {siblingTitle(
                          `${subjectName(grant.entrySubject)} authority`,
                          index,
                          grantItems.length,
                        )}
                      </span>
                      <small>
                        GRANT · {grant.state.replaceAll('_', ' ')} · CREATED {time(grant.createdAt)}
                      </small>
                    </h2>
                    <p>{grant.rationale}</p>
                  </div>
                  <span className="os-status-chip" data-state={grant.state}>
                    {grant.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <span>ENTRY · {subjectDescriptor(grant.entrySubject)}</span>
                  <span>RELEASE BINDING · EXACT IMMUTABLE VERSION</span>
                  <span>
                    RUNS · {grant.usedRuns} / {grant.maxRuns}
                  </span>
                  <span>
                    BUDGET · {money(grant.spentCostUsd)} / {money(grant.totalCostBudgetUsd)}
                  </span>
                  <span>EXPIRES · {time(grant.validUntil)}</span>
                  <span>TOOLS · {grant.toolScopes.join(', ') || 'no legacy tools'}</span>
                </div>
                <ExactReleaseBinding
                  entryResourceVersionId={grant.entryResourceVersionId}
                  releaseDigest={grant.releaseDigest}
                  releaseId={grant.releaseId}
                  subject={grant.entrySubject}
                />
                {grant.pluginScopes.length > 0 ? (
                  <div className="run-plugin-scopes">
                    <strong>GRANTED PLUGIN ACCESS</strong>
                    <ul>
                      {grant.pluginScopes.map((scope) => (
                        <li key={`${scope.installationId}:${scope.tool}`}>
                          <span>{scope.scopeDescription}</span>
                          <small>{scope.effect}</small>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {grant.state === 'active' ? (
                  <button
                    className="secondary-button run-action"
                    disabled={revoke.isPending}
                    onClick={() => setRevocationGrant(grant)}
                    type="button"
                  >
                    REVOKE AUTHORITY
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
      <section
        aria-busy={schedules.isLoading}
        className="os-panel schedule-panel"
        id="operate-schedules"
      >
        <header className="os-panel-heading">
          <h2>Durable schedules</h2>
          <small>CURRENT + HISTORY · DEDUPLICATED DISPATCH</small>
        </header>
        {schedules.isError ? (
          <Notice tone="error">
            Durable schedules unavailable. {getErrorMessage(schedules.error)}
          </Notice>
        ) : null}
        <div className="resource-grid">
          {schedules.isLoading ? (
            <div className="os-empty-state">Loading automation schedules…</div>
          ) : null}
          {!schedules.isLoading && !schedules.isError && scheduleItems.length === 0 ? (
            <div className="os-empty-state">
              <strong>No durable schedules configured.</strong>
              <span>Published automation definitions can create bounded recurring execution.</span>
            </div>
          ) : null}
          {scheduleItems.map((schedule, index) => (
            <article className="resource-card" key={schedule.id}>
              <header>
                <div>
                  <h2 className="record-heading">
                    <span>
                      {siblingTitle(
                        `${schedule.entrySubject?.name ?? 'Automation'} schedule`,
                        index,
                        scheduleItems.length,
                      )}
                    </span>
                    <small>
                      SCHEDULE · {schedule.state} · NEXT {time(schedule.nextRunAt)}
                    </small>
                  </h2>
                  <p>Channel · {schedule.channelKey}</p>
                </div>
                <span className="os-status-chip" data-state={schedule.state}>
                  {schedule.state}
                </span>
              </header>
              <div className="run-metadata">
                <span>ENTRY · {subjectDescriptor(schedule.entrySubject)}</span>
                <span>RELEASE BINDING · EXACT PRODUCTION POINTER</span>
                <span>NEXT · {time(schedule.nextRunAt)}</span>
                <span>INTERVAL · {schedule.intervalSeconds.toLocaleString()} seconds</span>
                <span>AUTHORITY · {schedule.authorityGrantId ? 'BOUND' : 'APPROVAL REQUIRED'}</span>
              </div>
              <ExactReleaseBinding
                authoredName={schedule.name}
                entryResourceVersionId={schedule.entryResourceVersionId}
                releaseDigest={schedule.releaseDigest}
                releaseId={schedule.releaseId}
                subject={schedule.entrySubject}
              />
              <ScheduleStateControl
                isPending={updateSchedule.isPending}
                onUpdate={(state, rationale) =>
                  updateSchedule.mutate({ scheduleId: schedule.id, state, rationale })
                }
                schedule={schedule}
              />
            </article>
          ))}
        </div>
      </section>
      <p className="os-disclosure">
        Authority is an exact, revocable envelope—not blanket approval. Any release, input, tool,
        expiry, run-count, or cost mismatch returns execution to human review.
      </p>
      {approvalRun ? (
        <ApprovalDialog
          error={approve.isError ? getErrorMessage(approve.error) : null}
          isApproving={approve.isPending}
          onApprove={(value) =>
            approve.mutate(
              { runId: approvalRun.id, value },
              { onSuccess: () => setApprovalRun(null) },
            )
          }
          onClose={() => setApprovalRun(null)}
          run={approvalRun}
        />
      ) : null}
      {revocationGrant ? (
        <GovernedActionDialog
          action={consoleActionCopy.revokeGrant}
          error={revoke.isError ? getErrorMessage(revoke.error) : null}
          introduction={consoleCriticalCopy.authorityRevocation.introduction}
          isPending={revoke.isPending}
          kicker="AUTHORITY REVOCATION"
          onClose={() => setRevocationGrant(null)}
          onConfirm={() =>
            revoke.mutate(revocationGrant.id, { onSuccess: () => setRevocationGrant(null) })
          }
          title={`Revoke ${subjectName(revocationGrant.entrySubject)} authority`}
        />
      ) : null}
    </main>
  );
}
