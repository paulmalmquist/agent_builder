import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  consoleCriticalCopy,
  type AttentionItem,
  type SurfaceAction,
} from '@agent-builder/contracts';
import {
  useApproveExecutionApprovalGroup,
  useAttention,
  useCancelExecutionRun,
  useDeclineRelease,
  useExecutionRun,
  usePromoteRelease,
  useRejectExecutionApprovalGroup,
  useResolveAttentionItem,
  useReviewImprovementCandidate,
  useReviewMemoryCandidate,
} from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { ApprovalDialog } from '../platform/ApprovalDialog';
import { AttentionDetailDialog } from './AttentionDetailDialog';
import { DecisionDialog } from './DecisionDialog';

interface PendingDecision {
  item: AttentionItem;
  action: SurfaceAction;
}

const EMPTY_ATTENTION_ITEMS: AttentionItem[] = [];

function money(value: number) {
  return `$${value.toFixed(value < 1 ? 2 : 0)}`;
}

function actionableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="dialog"]',
    ) !== null
  );
}

function decisionCopy(decision: PendingDecision) {
  const { action, item } = decision;
  const destructive = action.kind.startsWith('reject') || action.kind === 'decline_release';
  return {
    kicker: destructive ? 'RATIONALE REQUIRED' : 'HUMAN DECISION REQUIRED',
    title: action.label,
    explanation: item.reason,
    consequence: action.consequence,
    undo: action.undo,
    reviewFacts: item.payload.reviewFacts,
    confirmLabel: action.label,
  };
}

function AttentionCard({
  item,
  queuePosition,
  focused,
  setReference,
  onAction,
  onDetail,
  onFocus,
}: {
  item: AttentionItem;
  queuePosition: number;
  focused: boolean;
  setReference: (node: HTMLElement | null) => void;
  onAction: (action: SurfaceAction) => void;
  onDetail: () => void;
  onFocus: () => void;
}) {
  return (
    <article
      aria-label={item.headline}
      className={focused ? 'attention-card focused' : 'attention-card'}
      data-status={item.status}
      onFocus={onFocus}
      ref={setReference}
      tabIndex={0}
    >
      <div aria-hidden="true" className="attention-status-mark">
        <span>{String(queuePosition).padStart(2, '0')}</span>
      </div>
      <div className="attention-card-body">
        <header>
          <div>
            <span className="attention-kind">
              {item.status === 'safety_stop'
                ? 'SAFETY STOP'
                : item.status === 'degraded'
                  ? 'DEGRADED'
                  : 'DECISION'}{' '}
              · {item.kind.replaceAll('_', ' ')}
            </span>
            <h2>{item.headline}</h2>
          </div>
          {item.cost ? (
            <span className="attention-cost">
              {money(item.cost.usd)} / {item.cost.period}
              {item.cost.budgetUsd === null ? '' : ` · ${money(item.cost.budgetUsd)} budget`}
            </span>
          ) : null}
        </header>
        <p className="attention-delta">{item.delta}</p>
        <p className="attention-reason">{item.reason}</p>
        {item.payload.subject ? (
          <div className="attention-subject">
            <span>{item.payload.subject.kind}</span>
            <strong>{item.payload.subject.name}</strong>
            <span>{item.payload.subject.version}</span>
            {item.payload.requestCount > 1 ? (
              <button
                aria-haspopup="dialog"
                aria-label={`Inspect ${item.payload.requestCount} exact matching requests`}
                className="attention-request-count"
                onClick={onDetail}
                type="button"
              >
                {item.payload.requestCount} exact matching requests
              </button>
            ) : null}
          </div>
        ) : null}
        {item.primaryAction ? (
          <dl aria-label="Decision effects" className="attention-card-effects">
            <div>
              <dt>{item.primaryAction.label}</dt>
              <dd>
                {item.primaryAction.consequence}
                <small>UNDO · {item.primaryAction.undo}</small>
              </dd>
            </div>
            {item.secondaryAction ? (
              <div>
                <dt>{item.secondaryAction.label}</dt>
                <dd>
                  {item.secondaryAction.consequence}
                  <small>UNDO · {item.secondaryAction.undo}</small>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <footer>
          <button aria-haspopup="dialog" className="attention-why" onClick={onDetail} type="button">
            <Icon name="search" size={14} />
            {consoleCriticalCopy.attention.actions[0].label}
          </button>
          <div className="attention-actions">
            {item.secondaryAction ? (
              <button
                className="secondary-button"
                onClick={() => onAction(item.secondaryAction as SurfaceAction)}
                type="button"
              >
                {item.secondaryAction.label}
              </button>
            ) : null}
            {item.primaryAction ? (
              <button
                className="primary-button"
                onClick={() => onAction(item.primaryAction as SurfaceAction)}
                type="button"
              >
                {item.primaryAction.label}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </article>
  );
}

export function AttentionPage() {
  const attention = useAttention();
  const approve = useApproveExecutionApprovalGroup();
  const rejectGroup = useRejectExecutionApprovalGroup();
  const promote = usePromoteRelease();
  const decline = useDeclineRelease();
  const reviewMemory = useReviewMemoryCandidate();
  const reviewImprovement = useReviewImprovementCandidate();
  const cancelRun = useCancelExecutionRun();
  const resolveItem = useResolveAttentionItem();
  const [focusIndex, setFocusIndex] = useState(0);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [queueFailedClosed, setQueueFailedClosed] = useState(false);
  const cardReferences = useRef(new Map<string, HTMLElement>());
  const selectedRun = useExecutionRun(
    pending?.action.kind === 'approve_run' ? pending.item.payload.runId : null,
  );
  const queueUnavailable = attention.error !== null || queueFailedClosed;
  const decide = queueUnavailable
    ? EMPTY_ATTENTION_ITEMS
    : (attention.data?.decide ?? EMPTY_ATTENTION_ITEMS);
  const degraded = queueUnavailable
    ? EMPTY_ATTENTION_ITEMS
    : (attention.data?.degraded ?? EMPTY_ATTENTION_ITEMS);
  const items = useMemo(() => [...decide, ...degraded], [decide, degraded]);
  const activeIndex = items.length === 0 ? 0 : Math.min(focusIndex, items.length - 1);

  useEffect(() => {
    if (attention.error) {
      setQueueFailedClosed(true);
      setPending(null);
      setDetailItemId(null);
      cardReferences.current.clear();
      return;
    }
    if (queueFailedClosed && attention.isSuccess && !attention.isFetching) {
      setQueueFailedClosed(false);
    }
  }, [attention.error, attention.isFetching, attention.isSuccess, queueFailedClosed]);

  const focusCard = useCallback(
    (index: number) => {
      if (items.length === 0) return;
      const next = (index + items.length) % items.length;
      setFocusIndex(next);
      const item = items[next];
      if (item) {
        const node = cardReferences.current.get(item.id);
        node?.focus();
        node?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'nearest',
        });
      }
    },
    [items],
  );

  const openAction = useCallback((item: AttentionItem, action: SurfaceAction) => {
    if (action.kind === 'open_details' || action.kind === 'sign_in') {
      setDetailItemId(item.id);
      return;
    }
    setPending({ item, action });
  }, []);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || actionableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'j') {
        event.preventDefault();
        focusCard(activeIndex + 1);
      } else if (key === 'k') {
        event.preventDefault();
        focusCard(activeIndex - 1);
      } else if (key === 'e') {
        const item = items[activeIndex];
        if (item) {
          event.preventDefault();
          setDetailItemId(item.id);
        }
      } else if (key === 'a' || key === 'r') {
        const item = items[activeIndex];
        const action = key === 'a' ? item?.primaryAction : item?.secondaryAction;
        if (item && action) {
          event.preventDefault();
          openAction(item, action);
        }
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeIndex, focusCard, items, openAction]);

  const decisionError =
    rejectGroup.error ??
    promote.error ??
    decline.error ??
    reviewMemory.error ??
    reviewImprovement.error ??
    cancelRun.error ??
    resolveItem.error;

  const decisionPending =
    rejectGroup.isPending ||
    promote.isPending ||
    decline.isPending ||
    reviewMemory.isPending ||
    reviewImprovement.isPending ||
    cancelRun.isPending ||
    resolveItem.isPending;

  function confirmDecision(rationale: string) {
    if (!pending) return;
    const payload = pending.item.payload;
    const close = { onSuccess: () => setPending(null) };
    const decisionGroupBinding = payload.decisionGroupKey
      ? {
          decisionGroupKey: payload.decisionGroupKey,
          expectedRequestCount: payload.requestCount,
        }
      : {};
    switch (pending.action.kind) {
      case 'reject_run':
        if (payload.approvalGroupKey) {
          rejectGroup.mutate({ groupKey: payload.approvalGroupKey, rationale }, close);
        }
        break;
      case 'promote_release':
        if (payload.channelKey && payload.releaseId && payload.evaluationId) {
          promote.mutate(
            {
              channelKey: payload.channelKey,
              value: {
                releaseId: payload.releaseId,
                evaluationId: payload.evaluationId,
                rationale,
              },
            },
            close,
          );
        }
        break;
      case 'decline_release':
        if (payload.channelKey && payload.releaseId && payload.evaluationId) {
          decline.mutate(
            {
              channelKey: payload.channelKey,
              value: {
                releaseId: payload.releaseId,
                evaluationId: payload.evaluationId,
                rationale,
              },
            },
            close,
          );
        }
        break;
      case 'accept_memory':
      case 'reject_memory':
        if (payload.candidateId) {
          reviewMemory.mutate(
            {
              candidateId: payload.candidateId,
              value: {
                decision: pending.action.kind === 'accept_memory' ? 'accept' : 'reject',
                rationale,
                ...decisionGroupBinding,
              },
            },
            close,
          );
        }
        break;
      case 'incubate_candidate':
      case 'reject_candidate':
        if (payload.candidateId) {
          reviewImprovement.mutate(
            {
              candidateId: payload.candidateId,
              value: {
                decision: pending.action.kind === 'incubate_candidate' ? 'incubate' : 'reject',
                rationale,
                ...decisionGroupBinding,
              },
            },
            close,
          );
        }
        break;
      case 'cancel_run':
        if (payload.runId) cancelRun.mutate(payload.runId, close);
        break;
      case 'resolve_item':
        resolveItem.mutate({ itemId: pending.item.id, rationale }, close);
        break;
      default:
        break;
    }
  }

  return (
    <main className="attention-surface">
      <header className="attention-header">
        <div>
          <span className="attention-kicker">REVIEW QUEUE · VERDICT FIRST</span>
          <h1>Attention</h1>
          <p>{consoleCriticalCopy.attention.introduction.join(' ')}</p>
        </div>
        <div aria-label="Keyboard commands" className="attention-keyboard-help">
          <span>
            <kbd>J</kbd>/<kbd>K</kbd> MOVE
          </span>
          <span>
            <kbd>A</kbd> ACT
          </span>
          <span>
            <kbd>R</kbd> REJECT
          </span>
          <span>
            <kbd>E</kbd> DETAIL
          </span>
        </div>
      </header>
      {attention.error ? (
        <Notice tone="error">
          <span>{getErrorMessage(attention.error)}</span>
          <button
            className="secondary-button"
            disabled={attention.isFetching}
            onClick={() => void attention.refetch()}
            type="button"
          >
            {attention.isFetching ? 'Retrying…' : 'Retry loading'}
          </button>
        </Notice>
      ) : null}
      {attention.isLoading ? <div className="attention-empty">Loading review queue…</div> : null}
      {!attention.isLoading && !queueUnavailable && items.length === 0 ? (
        <section className="attention-all-quiet">
          <span aria-hidden="true" className="quiet-orbit" />
          <div>
            <span className="attention-kicker">NOMINAL</span>
            <h2>All quiet</h2>
            <p>
              {consoleCriticalCopy.allQuiet.introduction.join(' ')}
              {attention.data?.lastDeliveredBriefingAt
                ? ` Paul OS delivered your last briefing ${new Date(
                    attention.data.lastDeliveredBriefingAt,
                  ).toLocaleString()}.`
                : ' Your first platform briefing has not run yet.'}
            </p>
          </div>
        </section>
      ) : null}
      {decide.length > 0 ? (
        <section className="attention-shelf" aria-labelledby="decide-heading">
          <h2 id="decide-heading">
            Decide <span>{String(decide.length).padStart(2, '0')}</span>
          </h2>
          <div className="attention-queue">
            {decide.map((item, index) => (
              <AttentionCard
                focused={items[activeIndex]?.id === item.id}
                item={item}
                key={item.id}
                onAction={(action) => openAction(item, action)}
                onDetail={() => setDetailItemId(item.id)}
                onFocus={() => setFocusIndex(index)}
                queuePosition={index + 1}
                setReference={(node) => {
                  if (node) cardReferences.current.set(item.id, node);
                  else cardReferences.current.delete(item.id);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {degraded.length > 0 ? (
        <section className="attention-shelf degraded-shelf" aria-labelledby="degraded-heading">
          <h2 id="degraded-heading">
            Degraded <span>{String(degraded.length).padStart(2, '0')}</span>
          </h2>
          <div className="attention-queue">
            {degraded.map((item, index) => (
              <AttentionCard
                focused={items[activeIndex]?.id === item.id}
                item={item}
                key={item.id}
                onAction={(action) => openAction(item, action)}
                onDetail={() => setDetailItemId(item.id)}
                onFocus={() => setFocusIndex(decide.length + index)}
                queuePosition={decide.length + index + 1}
                setReference={(node) => {
                  if (node) cardReferences.current.set(item.id, node);
                  else cardReferences.current.delete(item.id);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {!queueUnavailable && attention.data && items.length > 0 ? (
        <section aria-label="Next briefing digest" className="attention-digest">
          <span>DIGEST</span>
          <p>{attention.data.digest.headline}</p>
          <small>Full detail arrives in the next successful Daily Briefing.</small>
        </section>
      ) : null}
      {!queueUnavailable && pending?.action.kind === 'approve_run' ? (
        selectedRun.data ? (
          <ApprovalDialog
            error={approve.error ? getErrorMessage(approve.error) : null}
            isApproving={approve.isPending}
            onApprove={(value) =>
              pending.item.payload.approvalGroupKey
                ? approve.mutate(
                    { groupKey: pending.item.payload.approvalGroupKey, value },
                    { onSuccess: () => setPending(null) },
                  )
                : undefined
            }
            onClose={() => setPending(null)}
            requestCount={pending.item.payload.requestCount}
            run={selectedRun.data}
            subject={pending.item.payload.subject}
          />
        ) : (
          <Modal
            kicker="HUMAN DECISION REQUIRED"
            onClose={() => setPending(null)}
            title="Review run"
          >
            {selectedRun.error ? (
              <Notice tone="error">{getErrorMessage(selectedRun.error)}</Notice>
            ) : (
              <p>Loading the exact release, input, scope, and budget limits…</p>
            )}
          </Modal>
        )
      ) : null}
      {!queueUnavailable && pending && pending.action.kind !== 'approve_run' ? (
        <DecisionDialog
          {...decisionCopy(pending)}
          error={decisionError ? getErrorMessage(decisionError) : null}
          isPending={decisionPending}
          onClose={() => setPending(null)}
          onConfirm={confirmDecision}
        />
      ) : null}
      {!queueUnavailable && detailItemId ? (
        <AttentionDetailDialog itemId={detailItemId} onClose={() => setDetailItemId(null)} />
      ) : null}
    </main>
  );
}
