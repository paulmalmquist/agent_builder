import { consoleCriticalCopy } from '@agent-builder/contracts';
import { useAttentionItem } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';

export function AttentionDetailDialog({
  itemId,
  onClose,
}: {
  itemId: string;
  onClose: () => void;
}) {
  const detail = useAttentionItem(itemId);
  const item = detail.data?.item;

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
          <dl className="attention-provenance">
            <div>
              <dt>Source</dt>
              <dd>{item.provenance.sourceType}</dd>
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
      {detail.data?.timeline.length ? (
        <section aria-label="Flight recorder" className="flight-recorder">
          <header>
            <h3>Flight recorder</h3>
            <small>PHASES · DURATION · COST</small>
          </header>
          <p>{consoleCriticalCopy.flightRecorder.introduction.join(' ')}</p>
          <ol>
            {detail.data.timeline.map((event) => (
              <li key={event.id}>
                <span aria-hidden="true" className="flight-node" />
                <div>
                  <strong>{event.phase}</strong>
                  <span>{event.message}</span>
                </div>
                <small>
                  {event.durationMs === null ? '—' : `${event.durationMs.toLocaleString()} ms`}
                  {' · '}
                  {event.costUsd === null ? '—' : `$${event.costUsd.toFixed(4)}`}
                </small>
              </li>
            ))}
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
