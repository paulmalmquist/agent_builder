import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  consoleCriticalCopy,
  type AttentionItem,
  type SurfaceAction,
} from '@agent-builder/contracts';
import {
  useApproveExecutionRun,
  useAttention,
  useCancelExecutionRun,
  useDeclineRelease,
  useExecutionRun,
  usePromoteRelease,
  useRejectExecutionRun,
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
  focused,
  setReference,
  onAction,
  onDetail,
  onFocus,
}: {
  item: AttentionItem;
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
        <span />
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
        {item.payload.scopes.length > 0 ? (
          <div aria-label="Authority scopes" className="attention-scopes">
            {item.payload.scopes.map((scope) => (
              <span key={scope}>{scope}</span>
            ))}
          </div>
        ) : null}
        {item.payload.reviewFacts.length > 0 ? (
          <dl className="attention-review-facts">
            {item.payload.reviewFacts.map((fact) => (
              <div key={`${fact.label}:${fact.value}`}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <footer>
          <button className="attention-why" onClick={onDetail} type="button">
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
  const approve = useApproveExecutionRun();
  const rejectRun = useRejectExecutionRun();
  const promote = usePromoteRelease();
  const decline = useDeclineRelease();
  const reviewMemory = useReviewMemoryCandidate();
  const reviewImprovement = useReviewImprovementCandidate();
  const cancelRun = useCancelExecutionRun();
  const resolveItem = useResolveAttentionItem();
  const [focusIndex, setFocusIndex] = useState(0);
  const [pending, setPending] = useState<PendingDecision | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const cardReferences = useRef(new Map<string, HTMLElement>());
  const selectedRun = useExecutionRun(
    pending?.action.kind === 'approve_run' ? pending.item.payload.runId : null,
  );
  const decide = attention.data?.decide ?? EMPTY_ATTENTION_ITEMS;
  const degraded = attention.data?.degraded ?? EMPTY_ATTENTION_ITEMS;
  const items = useMemo(() => [...decide, ...degraded], [decide, degraded]);
  const activeIndex = items.length === 0 ? 0 : Math.min(focusIndex, items.length - 1);

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
    rejectRun.error ??
    promote.error ??
    decline.error ??
    reviewMemory.error ??
    reviewImprovement.error ??
    cancelRun.error ??
    resolveItem.error;

  const decisionPending =
    rejectRun.isPending ||
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
    switch (pending.action.kind) {
      case 'reject_run':
        if (payload.runId) rejectRun.mutate({ runId: payload.runId, rationale }, close);
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
      {attention.error ? <Notice tone="error">{getErrorMessage(attention.error)}</Notice> : null}
      {attention.isLoading ? <div className="attention-empty">Loading review queue…</div> : null}
      {!attention.isLoading && !attention.error && items.length === 0 ? (
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
                setReference={(node) => {
                  if (node) cardReferences.current.set(item.id, node);
                  else cardReferences.current.delete(item.id);
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
      {attention.data && items.length > 0 ? (
        <section aria-label="Next briefing digest" className="attention-digest">
          <span>DIGEST</span>
          <p>{attention.data.digest.headline}</p>
          <small>Full detail arrives in the next successful Daily Briefing.</small>
        </section>
      ) : null}
      {pending?.action.kind === 'approve_run' ? (
        selectedRun.data ? (
          <ApprovalDialog
            error={approve.error ? getErrorMessage(approve.error) : null}
            isApproving={approve.isPending}
            onApprove={(value) =>
              approve.mutate(
                { runId: selectedRun.data.id, value },
                { onSuccess: () => setPending(null) },
              )
            }
            onClose={() => setPending(null)}
            run={selectedRun.data}
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
      {pending && pending.action.kind !== 'approve_run' ? (
        <DecisionDialog
          {...decisionCopy(pending)}
          error={decisionError ? getErrorMessage(decisionError) : null}
          isPending={decisionPending}
          onClose={() => setPending(null)}
          onConfirm={confirmDecision}
        />
      ) : null}
      {detailItemId ? (
        <AttentionDetailDialog itemId={detailItemId} onClose={() => setDetailItemId(null)} />
      ) : null}
    </main>
  );
}
