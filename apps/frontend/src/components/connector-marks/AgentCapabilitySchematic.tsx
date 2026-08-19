import { ConnectorMark, type ConnectorMarkDefinition } from './ConnectorMark';

export type ConnectorCapabilityEffect = 'read' | 'write' | 'destructive';
export type ConnectorCapabilityAuthority = 'granted' | 'declared';

export interface AgentConnectorCapability {
  authority: ConnectorCapabilityAuthority;
  brand: ConnectorMarkDefinition;
  detail: string;
  effect: ConnectorCapabilityEffect;
  id: string;
  name: string;
}

interface AgentCapabilitySchematicProps {
  agentName: string;
  capabilities: readonly AgentConnectorCapability[];
}

interface CapabilityBranchProps {
  capability: AgentConnectorCapability;
}

function effectLabel(effect: ConnectorCapabilityEffect): string {
  if (effect === 'read') return 'Read';
  if (effect === 'write') return 'Write';
  return 'Destructive';
}

function authorityLabel(authority: ConnectorCapabilityAuthority): string {
  return authority === 'granted' ? 'allowed by a current grant' : 'declared, not granted';
}

function CapabilityBranch({ capability }: CapabilityBranchProps) {
  const effect = effectLabel(capability.effect);
  const authority = authorityLabel(capability.authority);

  return (
    <li
      className="agent-capability-branch"
      data-authority={capability.authority}
      data-effect={capability.effect}
    >
      <span aria-hidden="true" className="agent-capability-line" />
      <span
        aria-label={`${effect}; ${authority}`}
        className="agent-capability-terminal"
        role="img"
      />
      <ConnectorMark
        active={capability.authority === 'granted'}
        definition={capability.brand}
        label={capability.name}
      />
      <span className="agent-capability-copy">
        <strong>{capability.name}</strong>
        <small>{capability.detail}</small>
      </span>
    </li>
  );
}

function CapabilityGroup({
  capabilities,
  label,
}: {
  capabilities: readonly AgentConnectorCapability[];
  label: string;
}) {
  return (
    <section className="agent-capability-group">
      <h4>{label}</h4>
      {capabilities.length > 0 ? (
        <ul>
          {capabilities.map((capability) => (
            <CapabilityBranch capability={capability} key={capability.id} />
          ))}
        </ul>
      ) : (
        <p>No declared capabilities.</p>
      )}
    </section>
  );
}

export function AgentCapabilitySchematic({
  agentName,
  capabilities,
}: AgentCapabilitySchematicProps) {
  const reads = capabilities.filter(({ effect }) => effect === 'read');
  const actions = capabilities.filter(({ effect }) => effect !== 'read');

  return (
    <section aria-label={`${agentName} connector authority`} className="agent-capability-schematic">
      <div className="agent-capability-origin">
        <strong>{agentName}</strong>
        <span>AGENT</span>
      </div>
      <div className="agent-capability-groups">
        <CapabilityGroup capabilities={reads} label="KNOWS · READ ONLY" />
        <CapabilityGroup capabilities={actions} label="CAN DO" />
      </div>
      <div aria-label="Capability legend" className="agent-capability-legend">
        <span>
          <i aria-hidden="true" data-effect="read" /> Read
        </span>
        <span>
          <i aria-hidden="true" data-effect="write" /> Write or destructive
        </span>
        <span>
          <i aria-hidden="true" data-authority="granted" /> Allowed now
        </span>
        <span>
          <i aria-hidden="true" data-authority="declared" /> Declared, not granted
        </span>
      </div>
    </section>
  );
}

export function AgentCapabilityStrip({ agentName, capabilities }: AgentCapabilitySchematicProps) {
  return (
    <ul aria-label={`${agentName} connector reach`} className="agent-capability-strip">
      {capabilities.map((capability) => (
        <li
          data-authority={capability.authority}
          data-effect={capability.effect}
          key={capability.id}
        >
          <ConnectorMark
            active={capability.authority === 'granted'}
            compact
            definition={capability.brand}
            label={capability.name}
          />
          <span aria-hidden="true" className="agent-capability-strip-effect" />
          <span className="sr-only">
            {capability.name}: {effectLabel(capability.effect)};{' '}
            {authorityLabel(capability.authority)}.
          </span>
        </li>
      ))}
    </ul>
  );
}
