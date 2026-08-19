import { ConnectorMark } from '../../components/connector-marks/ConnectorMark';
import type { AimAgentView, AimGroupView, AimPartView } from './aim-view-model';

interface AimGroupSelectorProps {
  groups: readonly AimGroupView[];
  onSelect: (groupId: string) => void;
  selectedGroupId: string;
}

export function AimGroupSelector({ groups, onSelect, selectedGroupId }: AimGroupSelectorProps) {
  return (
    <section aria-labelledby="aim-groups-title" className="aim-groups">
      <header className="aim-section-heading">
        <div>
          <span>01 · START WITH OWNERSHIP</span>
          <h2 id="aim-groups-title">Choose a group</h2>
        </div>
        <small>{groups.length} PRIMARY HARDWARE OWNERS</small>
      </header>
      <div className="aim-group-grid">
        {groups.map((group, index) => (
          <button
            aria-pressed={group.id === selectedGroupId}
            className="aim-group-tile"
            data-covered={group.hasCertifiedAgent}
            key={group.id}
            onClick={() => onSelect(group.id)}
            type="button"
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{group.label}</strong>
            <small>
              {group.ownedPartIds.length} {group.ownedPartIds.length === 1 ? 'PART' : 'PARTS'} ·{' '}
              {group.hasCertifiedAgent
                ? `${group.certifiedAgentCount} CURRENT CERTIFIED`
                : 'NO CURRENT CERTIFIED AGENT'}
            </small>
          </button>
        ))}
      </div>
    </section>
  );
}

interface AimManufacturingPanelProps {
  group: AimGroupView;
  onSelectPart: (partId: string) => void;
  parts: readonly AimPartView[];
  selectedPartId: string | null;
}

export function AimManufacturingPanel({
  group,
  onSelectPart,
  parts,
  selectedPartId,
}: AimManufacturingPanelProps) {
  const selectedPart = parts.find((part) => part.id === selectedPartId) ?? null;

  return (
    <section aria-labelledby="aim-manufacturing-title" className="aim-manufacturing-panel">
      <header className="aim-section-heading">
        <div>
          <span>02 · HOW IT IS MADE</span>
          <h2 id="aim-manufacturing-title">{group.label} hardware</h2>
        </div>
        <small>DECLARED BY THE LOCAL MANIFEST</small>
      </header>
      <div aria-label={`${group.label} hardware`} className="aim-part-chips" role="group">
        {parts.map((part) => (
          <button
            aria-pressed={part.id === selectedPartId}
            data-method={part.makeMethod}
            key={part.id}
            onClick={() => onSelectPart(part.id)}
            type="button"
          >
            <strong>{part.label}</strong>
            <span>{part.makeMethod.toUpperCase()}</span>
          </button>
        ))}
      </div>
      {selectedPart ? (
        <article className="aim-process-detail" data-method={selectedPart.makeMethod}>
          <header>
            <span>{selectedPart.makeMethod.toUpperCase()}</span>
            <strong>{selectedPart.label}</strong>
          </header>
          <p>{selectedPart.process}</p>
          <dl>
            <div>
              <dt>OWNER</dt>
              <dd>{selectedPart.ownerGroupLabel}</dd>
            </div>
            <div>
              <dt>MODELED AGENTS</dt>
              <dd>{selectedPart.coverage.agentIds.length}</dd>
            </div>
            <div>
              <dt>CERTIFIED AGENTS</dt>
              <dd>{selectedPart.coverage.certifiedAgentCount}</dd>
            </div>
            <div>
              <dt>EVIDENCE AGE</dt>
              <dd>
                {selectedPart.coverage.evidenceFreshnessHours === null
                  ? 'NOT AVAILABLE'
                  : `${selectedPart.coverage.evidenceFreshnessHours} HOURS`}
              </dd>
            </div>
          </dl>
        </article>
      ) : (
        <p className="aim-panel-instruction">
          Select hardware to inspect its process, modeled coverage, and agent reach.
        </p>
      )}
    </section>
  );
}

function AimAgentCard({ agent }: { agent: AimAgentView }) {
  const certificationLabel =
    agent.status === 'candidate'
      ? agent.synthetic
        ? 'CANDIDATE · SYNTHETIC SEED'
        : 'CANDIDATE · ACTIVE MANIFEST'
      : agent.certificationEvidenceFresh
        ? agent.synthetic
          ? 'CERTIFIED IN SYNTHETIC SEED'
          : 'CERTIFIED IN ACTIVE MANIFEST'
        : 'CERTIFICATION EVIDENCE NOT CURRENT';

  return (
    <article className="aim-agent-card" data-status={agent.status}>
      <header>
        <div>
          <span>R{agent.rung}</span>
          <strong>{agent.label}</strong>
        </div>
        <small>{certificationLabel}</small>
      </header>
      <p>{agent.description}</p>
      {agent.connectors.length > 0 ? (
        <ul aria-label={`${agent.label} declared connector reach`}>
          {agent.connectors.map((connector) => (
            <li data-access={connector.access} key={`${agent.id}:${connector.id}`}>
              <ConnectorMark
                compact
                definition={{
                  accent: connector.accent,
                  monogram: connector.monogram,
                  ...(connector.assetSrc ? { assetSrc: connector.assetSrc } : {}),
                }}
                label={connector.label}
              />
              <span>
                <strong>{connector.label}</strong>
                <small>
                  {connector.access.toUpperCase()} · DECLARED{' '}
                  {agent.synthetic ? 'SYNTHETIC' : 'MANIFEST'} REACH
                </small>
              </span>
              <i aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : (
        <small className="aim-agent-no-connectors">NO CONNECTOR REACH IS MODELED</small>
      )}
    </article>
  );
}

interface AimAgentPanelProps {
  agents: readonly AimAgentView[];
  group: AimGroupView;
  selectedPart: AimPartView | null;
}

export function AimAgentPanel({ agents, group, selectedPart }: AimAgentPanelProps) {
  return (
    <section aria-labelledby="aim-agents-title" className="aim-agent-panel">
      <header className="aim-section-heading">
        <div>
          <span>03 · AGENT COVERAGE</span>
          <h2 id="aim-agents-title">
            {selectedPart ? `Agents on ${selectedPart.label}` : `${group.label} agents`}
          </h2>
        </div>
        <small>MODELED REACH · NOT LIVE AUTHORITY</small>
      </header>
      {agents.length > 0 ? (
        <div className="aim-agent-list">
          {agents.map((agent) => (
            <AimAgentCard agent={agent} key={agent.id} />
          ))}
        </div>
      ) : (
        <p className="aim-no-agent">
          <strong>NO MODELED AGENT SERVES THIS {selectedPart ? 'HARDWARE' : 'GROUP'}.</strong>
          This is a manifest coverage gap, not a live staffing or deployment claim.
        </p>
      )}
    </section>
  );
}
