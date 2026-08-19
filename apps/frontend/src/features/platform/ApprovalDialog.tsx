import { useState, type FormEvent } from 'react';
import {
  consoleCriticalCopy,
  type ExecutionRun,
  type RunPluginRequirement,
} from '@agent-builder/contracts';
import type { ApproveRunInput } from '../../api/client';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

interface ApprovalDialogProps {
  run: ExecutionRun;
  error: string | null;
  isApproving: boolean;
  onApprove: (value: ApproveRunInput) => void;
  onClose: () => void;
  requestCount?: number;
  subject?: {
    name: string;
    kind: string;
    version: string;
  } | null;
}

function tomorrowLocalInput() {
  const next = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const offset = next.getTimezoneOffset() * 60_000;
  return new Date(next.getTime() - offset).toISOString().slice(0, 16);
}

type PluginLimitKey = keyof RunPluginRequirement['limits'];

const limitLabels: Record<PluginLimitKey, string> = {
  timeoutMs: 'Timeout · milliseconds',
  maxResponseBytes: 'Response cap · bytes',
  maxRecords: 'Record cap',
  maxInvocationsPerRun: 'Calls per run',
  maximumBytesBilled: 'Billed bytes cap',
  maxEstimatedCostUsd: 'Estimated cost cap · USD',
};

function PluginScopeEditor({
  scopes,
  ceilings,
  selected,
  onToggle,
  onLimit,
}: {
  scopes: RunPluginRequirement[];
  ceilings: RunPluginRequirement[];
  selected: boolean[];
  onToggle: (index: number, enabled: boolean) => void;
  onLimit: (index: number, key: PluginLimitKey, value: number) => void;
}) {
  if (scopes.length === 0) {
    return <p className="os-disclosure">No Plugin access is requested for this run.</p>;
  }
  return (
    <fieldset className="plugin-scope-editor full-field">
      <legend>Plugin authority</legend>
      <p>These choices come from the server. You may remove access or lower a ceiling.</p>
      {scopes.map((scope, index) => (
        <article className="plugin-scope-choice" key={`${scope.installationId}:${scope.tool}`}>
          <label className="plugin-scope-toggle">
            <input
              checked={selected[index] ?? false}
              onChange={(event) => onToggle(index, event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>{scope.scopeDescription}</strong>
              <small>
                {scope.effect} · {scope.executionPlacement.replace('_', ' ')} · {scope.tool}
              </small>
            </span>
          </label>
          {selected[index] ? (
            <div className="plugin-limit-grid">
              {(Object.entries(scope.limits) as Array<[PluginLimitKey, number]>).map(
                ([key, value]) => (
                  <label key={key}>
                    {limitLabels[key]}
                    <input
                      max={ceilings[index]?.limits[key]}
                      min={
                        key === 'maxEstimatedCostUsd' || key === 'maximumBytesBilled'
                          ? 0
                          : key === 'timeoutMs'
                            ? 100
                            : 1
                      }
                      onChange={(event) => onLimit(index, key, event.currentTarget.valueAsNumber)}
                      step={key === 'maxEstimatedCostUsd' ? 0.01 : 1}
                      type="number"
                      value={value}
                    />
                  </label>
                ),
              )}
            </div>
          ) : null}
        </article>
      ))}
    </fieldset>
  );
}

export function ApprovalDialog({
  run,
  error,
  isApproving,
  onApprove,
  onClose,
  requestCount = 1,
  subject = null,
}: ApprovalDialogProps) {
  const reviewedRequestCount = Math.max(1, requestCount);
  const perRunFloor = Math.max(run.estimatedUpperCostUsd, run.maxEstimatedCostUsd, 0.01);
  const reviewedCostFloor = run.estimatedUpperCostUsd * reviewedRequestCount;
  const [validUntil, setValidUntil] = useState(tomorrowLocalInput);
  const [maxRuns, setMaxRuns] = useState(reviewedRequestCount);
  const [perRunCost, setPerRunCost] = useState(perRunFloor);
  const [totalCost, setTotalCost] = useState(() => Math.max(perRunFloor, reviewedCostFloor));
  const [toolScopes, setToolScopes] = useState(() => run.requiredToolScopes.map(() => true));
  const [pluginScopes, setPluginScopes] = useState(() =>
    run.requiredPluginScopes.map((scope) => ({ ...scope, limits: { ...scope.limits } })),
  );
  const [selectedPluginScopes, setSelectedPluginScopes] = useState(() =>
    run.requiredPluginScopes.map(() => true),
  );
  const [rationale, setRationale] = useState(() =>
    reviewedRequestCount === 1
      ? 'Approve the bounded first run of this release.'
      : `Approve bounded authority for ${reviewedRequestCount} reviewed matching runs.`,
  );
  const selectedToolScopes = run.requiredToolScopes.filter((_scope, index) => toolScopes[index]);
  const totalCostFloor = Math.max(perRunCost, reviewedCostFloor);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (run.entryResourceVersionId === null) return;
    onApprove({
      entryResourceVersionId: run.entryResourceVersionId,
      projectId: run.projectId,
      inputConstraints: run.input,
      toolScopes: selectedToolScopes,
      pluginScopes: pluginScopes.flatMap((scope, index) =>
        selectedPluginScopes[index]
          ? [
              {
                installationId: scope.installationId,
                pluginVersionId: scope.pluginVersionId,
                tool: scope.tool,
                limits: scope.limits,
              },
            ]
          : [],
      ),
      validUntil: new Date(validUntil).toISOString(),
      maxRuns,
      maxEstimatedCostPerRunUsd: perRunCost,
      totalCostBudgetUsd: totalCost,
      rationale,
    });
  }

  return (
    <Modal kicker="DIGEST-BOUND AUTHORITY" onClose={onClose} title="Approve execution envelope">
      <p>{consoleCriticalCopy.runApproval.introduction.join(' ')}</p>
      <p>{consoleCriticalCopy.runApproval.body.join(' ')}</p>
      <p>
        This grant applies only to release <code>{run.releaseDigest.slice(0, 14)}…</code>. Scope,
        expiry, run count, or budget changes require a new human decision.
      </p>
      {subject ? (
        <p className="os-disclosure">
          SUBJECT · {subject.name} · {subject.kind.toUpperCase()} {subject.version}
        </p>
      ) : null}
      {reviewedRequestCount > 1 ? (
        <Notice>
          One decision covers {reviewedRequestCount} exact matching pending runs
          {subject ? ` of ${subject.name}` : ''}. The envelope must cover all of them before any
          work queues.
        </Notice>
      ) : null}
      <p className="os-disclosure">
        PROJECT · {run.projectId ?? 'UNSCOPED'} · INPUT CONSTRAINTS DEFAULT TO THIS EXACT RUN
      </p>
      <p className="os-disclosure">
        RETRY ·{' '}
        {run.maxAttempts === 1
          ? 'ONE ATTEMPT · NO AUTOMATIC RETRY'
          : `UP TO ${run.maxAttempts} TOTAL ATTEMPTS · ${run.retryBackoff.toUpperCase()} BACKOFF`}
      </p>
      {run.approvalReasons.length > 0 ? <Notice>{run.approvalReasons.join(' · ')}</Notice> : null}
      {run.legacyEntrypointUnresolved ? (
        <Notice tone="error">
          This historical run has no verifiable release entrypoint. It cannot be approved or
          resumed.
        </Notice>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <form className="form-grid" onSubmit={submit}>
        <label>
          Valid until
          <input
            min={new Date().toISOString().slice(0, 16)}
            onChange={(event) => setValidUntil(event.target.value)}
            required
            type="datetime-local"
            value={validUntil}
          />
        </label>
        <label>
          Maximum runs
          <input
            max={1_000_000}
            min={reviewedRequestCount}
            onChange={(event) => setMaxRuns(event.currentTarget.valueAsNumber)}
            required
            type="number"
            value={maxRuns}
          />
        </label>
        <label>
          Per-run ceiling · USD
          <input
            min={perRunFloor}
            onChange={(event) => setPerRunCost(event.currentTarget.valueAsNumber)}
            required
            step="0.01"
            type="number"
            value={perRunCost}
          />
        </label>
        <label>
          Total budget · USD
          <input
            min={totalCostFloor}
            onChange={(event) => setTotalCost(event.currentTarget.valueAsNumber)}
            required
            step="0.01"
            type="number"
            value={totalCost}
          />
        </label>
        <fieldset className="legacy-scope-editor full-field">
          <legend>Other tool authority</legend>
          {run.requiredToolScopes.length === 0 ? (
            <p className="os-disclosure">No legacy tool access is requested.</p>
          ) : (
            run.requiredToolScopes.map((scope, index) => (
              <label key={scope}>
                <input
                  checked={toolScopes[index] ?? false}
                  onChange={(event) =>
                    setToolScopes((current) =>
                      current.map((enabled, currentIndex) =>
                        currentIndex === index ? event.target.checked : enabled,
                      ),
                    )
                  }
                  type="checkbox"
                />
                <span>{scope}</span>
              </label>
            ))
          )}
        </fieldset>
        <PluginScopeEditor
          ceilings={run.requiredPluginScopes}
          onLimit={(index, key, value) =>
            Number.isFinite(value)
              ? setPluginScopes((current) =>
                  current.map((scope, currentIndex) =>
                    currentIndex === index
                      ? { ...scope, limits: { ...scope.limits, [key]: value } }
                      : scope,
                  ),
                )
              : undefined
          }
          onToggle={(index, enabled) =>
            setSelectedPluginScopes((current) =>
              current.map((selected, currentIndex) =>
                currentIndex === index ? enabled : selected,
              ),
            )
          }
          scopes={pluginScopes}
          selected={selectedPluginScopes}
        />
        <label className="full-field">
          Approval rationale
          <textarea
            maxLength={2_000}
            minLength={10}
            onChange={(event) => setRationale(event.target.value)}
            required
            value={rationale}
          />
        </label>
        <div className="modal-actions full-field">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              isApproving ||
              maxRuns < reviewedRequestCount ||
              totalCost < totalCostFloor ||
              run.legacyEntrypointUnresolved
            }
            type="submit"
          >
            {isApproving ? 'Binding authority…' : consoleCriticalCopy.runApproval.actions[0].label}
          </button>
        </div>
        <p className="os-disclosure full-field">
          {consoleCriticalCopy.runApproval.actions[0].consequence}{' '}
          {consoleCriticalCopy.runApproval.actions[0].undo}
        </p>
      </form>
    </Modal>
  );
}
