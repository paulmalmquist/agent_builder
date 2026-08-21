import { consoleCriticalCopy } from '@agent-builder/contracts';
import { useAttentionItem } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { recordedAttentionSourceLabel } from './attention-provenance';

function phaseLabel(value: string): string {
  const normalized = value.replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase();
  return normalized.length === 0
    ? 'Recorded phase'
    : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

export function AttentionDetailDialog({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const detail = useAttentionItem(itemId);
  const item = detail.data?.item;
  const membership = detail.data?.membership ?? null;
  const timeline = [...(detail.data?.timeline ?? [])].sort((left, right) =>
    left.occurredAt.localeCompare(right.occurredAt),
  );

  return (
    <Modal
      kicker="WHY YOU ARE SEEING THIS"
      onClose={onClose}
      title={item?.headline ?? 'Review detail'}
    >
      {detail.isLoading ? <p>Loading provenance and timeline…</p> : null}
      {detail.error ? <Notice tone="error">{getErrorMessage(detail.error)}</Notice> : null}
      {item ? (
        <>
          <p>{item.reason}</p>
          {item.payload.requestCount > 1 ? (
            <section aria-label="Grouped request review" className="attention-group-review">
              <h3>{item.payload.requestCount} exact matching requests</h3>
              <p>
                These governed source records share the decision evidence below and will be decided
                together as one atomic group.
              </p>
            </section>
          ) : null}
          {item.payload.reviewFacts.length > 0 ? (
            <dl aria-label="Decision evidence" className="attention-review-facts">
              {item.payload.reviewFacts.map((fact) => (
                <div key={`${fact.label}:${fact.value}`}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {membership ? (
            <section aria-label="Exact group membership" className="attention-membership">
              <header>
                <h3>Exact group membership</h3>
                <span>{membership.exactCount} RECORDS</span>
              </header>
              <ol>
                {membership.records.map((record) => (
                  <li key={record.technicalReferences[0]?.value ?? record.label}>
                    <div className="attention-membership-heading">
                      <div>
                        <strong>{record.label}</strong>
                        <span>
                          {record.subject
                            ? `${record.subject.name} · ${record.subject.kind} ${record.subject.version}`
                            : 'Governed subject unavailable'}
                        </span>
                      </div>
                      <time dateTime={record.occurredAt}>
                        {new Date(record.occurredAt).toLocaleString()}
                      </time>
                    </div>
                    <dl>
                      {record.evidence.map((fact) => (
                        <div key={`${fact.label}:${fact.value}`}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <details>
                      <summary>Technical membership</summary>
                      <dl>
                        {record.technicalReferences.map((reference) => (
                          <div key={`${reference.label}:${reference.value}`}>
                            <dt>{reference.label}</dt>
                            <dd>
                              <code>{reference.value}</code>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          <dl className="attention-provenance">
            <div>
              <dt>Source</dt>
              <dd>{recordedAttentionSourceLabel(item.provenance.sourceType)}</dd>
            </div>
            <div>
              <dt>Occurred</dt>
              <dd>{new Date(item.occurredAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Explanation</dt>
              <dd>{item.provenance.explanation}</dd>
            </div>
          </dl>
        </>
      ) : null}
      {timeline.length ? (
        <section aria-label="Flight recorder" className="flight-recorder">
          <header>
            <h3>Flight recorder</h3>
            <small>CHRONOLOGICAL PHASES · RECORDED TELEMETRY</small>
          </header>
          <p>{consoleCriticalCopy.flightRecorder.introduction.join(' ')}</p>
          <ol>
            {timeline.map((event) => {
              const metrics = [
                event.durationMs === null ? null : `${event.durationMs.toLocaleString()} ms`,
                event.costUsd === null ? null : `$${event.costUsd.toFixed(4)}`,
              ].filter((value): value is string => value !== null);
              return (
                <li key={event.id}>
                  <span aria-hidden="true" className="flight-node" />
                  <div>
                    <strong>{phaseLabel(event.phase)}</strong>
                    <span>{event.message}</span>
                  </div>
                  {metrics.length > 0 ? <small>{metrics.join(' · ')}</small> : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <div className="modal-actions">
        <button className="secondary-button" onClick={onClose} type="button">
          {consoleCriticalCopy.flightRecorder.actions[0].label}
        </button>
      </div>
    </Modal>
  );
}
