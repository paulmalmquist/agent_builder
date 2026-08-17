import { Modal } from '../../components/Modal';
import type { AimScenePart } from './scene/scene-types';

interface PocCardProps {
  part: AimScenePart;
  onClose: () => void;
}

function ReadoutList({ values, empty }: { values: readonly string[]; empty: string }) {
  if (values.length === 0) return <span>{empty}</span>;
  return (
    <ul>
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

export function PocCard({ part, onClose }: PocCardProps) {
  const evidenceWarning = part.evidenceState === 'missing' || part.evidenceState === 'stale';

  return (
    <Modal kicker="MANIFEST-DRIVEN POC CARD" onClose={onClose} size="wide" title={part.label}>
      <div className="aim-poc-card">
        <div className="aim-poc-verdict">
          <span className="os-status-chip" data-state={part.lifecycle}>
            {part.lifecycle}
          </span>
          <span className="os-status-chip" data-state={part.readiness}>
            {part.readiness.replace('_', ' ')}
          </span>
          {evidenceWarning ? <strong>{part.evidenceMessage}</strong> : null}
        </div>
        <section>
          <span>PROBLEM</span>
          <p>{part.problem}</p>
        </section>
        <div className="aim-poc-grid">
          <section>
            <span>PARTICIPATING GROUPS</span>
            <ReadoutList empty="No participating group is declared." values={part.groupLabels} />
          </section>
          <section>
            <span>PRIMARY OWNER</span>
            <p>{part.primaryOwner ?? 'Hidden by the current display policy.'}</p>
          </section>
          <section>
            <span>CAPABILITY LAYER</span>
            <ReadoutList empty="No capability is linked." values={part.capabilityLabels} />
          </section>
          <section>
            <span>DECISION LOOP ACCELERATED</span>
            <ReadoutList empty="No decision loop is linked." values={part.decisionLoopLabels} />
          </section>
        </div>
        <section>
          <span>DECISION LATENCY</span>
          <div className="aim-latency-strip">
            <div>
              <small>BASELINE</small>
              <strong>{part.latency.baseline ?? 'NOT SOURCED'}</strong>
            </div>
            <div>
              <small>CURRENT</small>
              <strong>{part.latency.current ?? 'NOT SOURCED'}</strong>
            </div>
            <div>
              <small>TARGET</small>
              <strong>{part.latency.target ?? 'NOT SOURCED'}</strong>
            </div>
          </div>
        </section>
        <section>
          <span>EVIDENCE</span>
          {part.evidence.length > 0 ? (
            <div className="aim-evidence-list">
              {part.evidence.map((evidence) => (
                <article data-freshness={evidence.freshness} key={evidence.id}>
                  <strong>{evidence.label}</strong>
                  <span>{evidence.sourceLabel}</span>
                  <time dateTime={evidence.observedAt}>{evidence.observedAt}</time>
                  <small>{evidence.freshness.toUpperCase()}</small>
                </article>
              ))}
            </div>
          ) : (
            <p>{part.evidenceMessage}</p>
          )}
        </section>
        <div className="aim-poc-grid">
          <section>
            <span>SOURCE</span>
            <ReadoutList empty="No displayable source is declared." values={part.sourceLabels} />
            <small>LAST SYNC · {part.lastSynchronizedAt ?? 'NOT AVAILABLE'}</small>
          </section>
          <section>
            <span>WHAT THIS UNLOCKS NEXT</span>
            <ReadoutList empty="No downstream component is declared." values={part.unlockLabels} />
          </section>
          <section>
            <span>DEPENDENCIES</span>
            <ReadoutList
              empty="No component dependency is declared."
              values={part.dependencyLabels}
            />
          </section>
        </div>
      </div>
    </Modal>
  );
}
