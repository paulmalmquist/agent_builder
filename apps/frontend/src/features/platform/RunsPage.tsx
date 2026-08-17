import { useState, type FormEvent } from 'react';
import type { AutomationSchedule, ExecutionRun } from '@agent-builder/contracts';
import {
  useApproveExecutionRun,
  useAutomationSchedules,
  useAuthorityGrants,
  useCancelExecutionRun,
  useExecutionRuns,
  useRevokeAuthorityGrant,
  useUpdateAutomationScheduleState,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { ApprovalDialog } from './ApprovalDialog';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

function money(value: number | null) {
  return value === null ? '—' : `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not started';
}

function elapsed(start: string | null, end: string | null) {
  if (start === null || end === null) return '—';
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
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
  return (
    <details className="run-flight-recorder">
      <summary>
        <span>FLIGHT RECORDER</span>
        <span>
          {run.progress}% · {money(run.actualCostUsd)}
        </span>
      </summary>
      <ol aria-label={`Run ${run.id.slice(0, 8)} phases`}>
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
        <span>ACTUAL COST · {money(run.actualCostUsd)}</span>
        <span>CEILING · {money(run.maxEstimatedCostUsd)}</span>
        <span>ATTEMPTS · {run.attempts}</span>
      </footer>
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
        <span className="sr-only">Rationale for changing {schedule.name}</span>
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
  const runs = useExecutionRuns({ limit: 50 });
  const grants = useAuthorityGrants({ limit: 50 });
  const schedules = useAutomationSchedules();
  const approve = useApproveExecutionRun();
  const cancel = useCancelExecutionRun();
  const revoke = useRevokeAuthorityGrant();
  const updateSchedule = useUpdateAutomationScheduleState();
  const [approvalRun, setApprovalRun] = useState<ExecutionRun | null>(null);
  const runItems = runs.data?.items ?? [];
  const grantItems = grants.data?.items ?? [];
  const scheduleItems = schedules.data?.items ?? [];
  const awaiting = runItems.filter((run) => run.state === 'awaiting_approval');
  const activeRuns = runItems.filter((run) => run.state === 'queued' || run.state === 'running');
  const activeGrants = grantItems.filter((grant) => grant.state === 'active');
  const combinedError =
    runs.error ??
    grants.error ??
    schedules.error ??
    cancel.error ??
    revoke.error ??
    updateSchedule.error;

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Observe durable execution, approve digest-bound authority, and revoke unattended access without changing the underlying release."
        kicker="EXECUTION CONTROL & HUMAN AUTHORITY"
        stateDetail="LEASED RUNS · FAIL-CLOSED GRANTS"
        title="Runs & Approvals"
      />
      <InstrumentStrip
        readings={[
          { label: 'AWAITING APPROVAL', value: awaiting.length },
          { label: 'ACTIVE RUNS', value: activeRuns.length },
          { label: 'ACTIVE GRANTS', value: activeGrants.length },
          {
            label: 'ACTIVE SCHEDULES',
            value: scheduleItems.filter((schedule) => schedule.state === 'active').length,
          },
        ]}
      />
      {combinedError ? <Notice tone="error">{getErrorMessage(combinedError)}</Notice> : null}
      <div className="runs-layout">
        <section aria-busy={runs.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Execution ledger</h2>
            <small>NEWEST FIRST · AUTO REFRESH</small>
          </header>
          <div className="run-list">
            {runs.isLoading ? <div className="os-empty-state">Loading durable runs…</div> : null}
            {!runs.isLoading && runItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No execution runs yet.</strong>
                <span>Imported releases appear here after an execution is requested.</span>
              </div>
            ) : null}
            {runItems.map((run) => (
              <article className="run-card" key={run.id}>
                <header>
                  <div>
                    <h2>Run {run.id.slice(0, 8)}</h2>
                    <p>{run.message}</p>
                  </div>
                  <span className="os-status-chip" data-state={run.state}>
                    {run.state.replaceAll('_', ' ')}
                  </span>
                </header>
                <div className="run-metadata">
                  <code title={run.releaseDigest}>RELEASE · {run.releaseDigest.slice(0, 16)}…</code>
                  <span>
                    PROVIDER · {run.providerKind} / {run.model}
                  </span>
                  <span>
                    COST · {money(run.actualCostUsd)} / {money(run.maxEstimatedCostUsd)} ceiling
                  </span>
                  <span>START · {time(run.startedAt)}</span>
                </div>
                <PluginScopeSummary scopes={run.requiredPluginScopes} />
                <RunFlightRecorder run={run} />
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
        <section aria-busy={grants.isLoading} className="os-panel">
          <header className="os-panel-heading">
            <h2>Authority envelopes</h2>
            <small>EXACT RELEASE DIGESTS</small>
          </header>
          <div className="approval-list">
            {grants.isLoading ? (
              <div className="os-empty-state">Loading authority grants…</div>
            ) : null}
            {!grants.isLoading && grantItems.length === 0 ? (
              <div className="os-empty-state">
                <strong>No authority has been granted.</strong>
                <span>The first production-shaped run must receive a human decision.</span>
              </div>
            ) : null}
            {grantItems.map((grant) => (
              <article className="approval-card" key={grant.id}>
                <header>
                  <div>
                    <h2>Grant {grant.id.slice(0, 8)}</h2>
                    <p>{grant.rationale}</p>
                  </div>
                  <span className="os-status-chip" data-state={grant.state}>
                    {grant.state}
                  </span>
                </header>
                <div className="run-metadata">
                  <code title={grant.releaseDigest}>
                    RELEASE · {grant.releaseDigest.slice(0, 16)}…
                  </code>
                  <span>
                    RUNS · {grant.usedRuns} / {grant.maxRuns}
                  </span>
                  <span>
                    BUDGET · {money(grant.spentCostUsd)} / {money(grant.totalCostBudgetUsd)}
                  </span>
                  <span>EXPIRES · {time(grant.validUntil)}</span>
                  <span>TOOLS · {grant.toolScopes.join(', ') || 'no legacy tools'}</span>
                </div>
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
                    onClick={() => revoke.mutate(grant.id)}
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
      <section aria-busy={schedules.isLoading} className="os-panel schedule-panel">
        <header className="os-panel-heading">
          <h2>Durable schedules</h2>
          <small>PRODUCTION POINTER · DEDUPLICATED DISPATCH</small>
        </header>
        <div className="resource-grid">
          {schedules.isLoading ? (
            <div className="os-empty-state">Loading automation schedules…</div>
          ) : null}
          {!schedules.isLoading && scheduleItems.length === 0 ? (
            <div className="os-empty-state">
              <strong>No durable schedules configured.</strong>
              <span>Published automation definitions can create bounded recurring execution.</span>
            </div>
          ) : null}
          {scheduleItems.map((schedule) => (
            <article className="resource-card" key={schedule.id}>
              <header>
                <div>
                  <h2>{schedule.name}</h2>
                  <p>Channel · {schedule.channelKey}</p>
                </div>
                <span className="os-status-chip" data-state={schedule.state}>
                  {schedule.state}
                </span>
              </header>
              <div className="run-metadata">
                <code title={schedule.releaseDigest}>
                  RELEASE · {schedule.releaseDigest.slice(0, 16)}…
                </code>
                <span>NEXT · {time(schedule.nextRunAt)}</span>
                <span>INTERVAL · {schedule.intervalSeconds.toLocaleString()} seconds</span>
                <span>AUTHORITY · {schedule.authorityGrantId ? 'BOUND' : 'APPROVAL REQUIRED'}</span>
              </div>
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
    </main>
  );
}
