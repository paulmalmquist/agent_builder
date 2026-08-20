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
  manifestSummary?:
    | {
        actions: readonly string[];
        boundaries: readonly string[];
        knowledge: readonly string[];
        state: 'declared' | 'unavailable';
      }
    | undefined;
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
  declarations = [],
  emptyCopy,
  label,
}: {
  capabilities: readonly AgentConnectorCapability[];
  declarations?: readonly string[];
  emptyCopy: string;
  label: string;
}) {
  return (
    <section className="agent-capability-group">
      <h4>{label}</h4>
      {declarations.length > 0 ? (
        <ol className="agent-capability-declarations">
          {declarations.map((declaration, index) => (
            <li key={`${index}-${declaration}`}>{declaration}</li>
          ))}
        </ol>
      ) : null}
      {capabilities.length > 0 ? (
        <ul>
          {capabilities.map((capability) => (
            <CapabilityBranch capability={capability} key={capability.id} />
          ))}
        </ul>
      ) : declarations.length === 0 ? (
        <p>{emptyCopy}</p>
      ) : null}
    </section>
  );
}

export function AgentCapabilitySchematic({
  agentName,
  capabilities,
  manifestSummary,
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
        <CapabilityGroup
          capabilities={reads}
          declarations={manifestSummary?.knowledge ?? []}
          emptyCopy={
            manifestSummary?.state === 'declared'
              ? 'No knowledge source is declared in this manifest.'
              : manifestSummary
                ? 'Knowledge declarations are unavailable.'
                : 'No declared capabilities.'
          }
          label={manifestSummary ? 'KNOWS · DECLARED SOURCES' : 'KNOWS · READ ONLY'}
        />
        <CapabilityGroup
          capabilities={actions}
          declarations={manifestSummary?.actions ?? []}
          emptyCopy={
            manifestSummary?.state === 'declared'
              ? 'No workflow stage is declared in this manifest.'
              : manifestSummary
                ? 'Action declarations are unavailable.'
                : 'No declared capabilities.'
          }
          label={manifestSummary ? 'CAN DO · DECLARED WORKFLOW' : 'CAN DO'}
        />
        {manifestSummary && manifestSummary.boundaries.length > 0 ? (
          <section className="agent-capability-group agent-capability-boundaries">
            <h4>BOUNDARIES · MANIFEST CONTRACT</h4>
            <ul>
              {manifestSummary.boundaries.map((boundary, index) => (
                <li key={`${index}-${boundary}`}>{boundary}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <div aria-label="Capability legend" className="agent-capability-legend">
        {capabilities.length > 0 ? (
          <>
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
          </>
        ) : null}
        {manifestSummary?.state === 'declared' ? (
          <p>Manifest declarations do not grant connector authority.</p>
        ) : manifestSummary ? (
          <p>The typed manifest contract is unavailable; no behavior is inferred.</p>
        ) : null}
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
