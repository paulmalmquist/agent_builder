import { useMemo } from 'react';
import type { ResourceVersion } from '@agent-builder/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import {
  useAuthorityGrants,
  useObservations,
  usePlatformResource,
  usePlatformResources,
  usePlugins,
} from '../../api/hooks';
import { Notice } from '../../components/Notice';
import {
  AgentCapabilitySchematic,
  type AgentConnectorCapability,
} from '../../components/connector-marks/AgentCapabilitySchematic';
import { SurfaceHeader } from '../platform/SurfaceHeader';
import { featureFlags } from '../../config/feature-flags';
import {
  distinctResourceVersions,
  humanizeOperationalSignal,
  isQuarantinedResource,
} from '../../lib/user-facing-index';
import './knowledge.css';

type KnowledgeType =
  | 'people'
  | 'systems'
  | 'projects'
  | 'decisions'
  | 'datasets'
  | 'runbooks'
  | 'incidents'
  | 'metrics'
  | 'agents';

interface KnowledgeTypeDefinition {
  description: string;
  kinds: readonly ResourceVersion['kind'][];
  label: string;
  number: string;
  transferRequired?: boolean;
}

interface DefinitionRelationship {
  declaredBy: Pick<ResourceVersion, 'name' | 'version'>;
  predicate: 'DEPENDS ON' | 'USED BY';
  source: ResourceVersion;
  target: ResourceVersion;
}

function DefinitionEdge({ relationship }: { relationship: DefinitionRelationship }) {
  const { declaredBy, predicate, source, target } = relationship;
  return (
    <li
      aria-label={`${source.name} ${predicate} ${target.name}`}
      className="knowledge-edge"
      data-predicate={predicate.toLowerCase().replace(' ', '-')}
    >
      <div className="knowledge-edge-origin">
        <span>{displayKind(source.kind)}</span>
        <strong>{source.name}</strong>
        <small>V{source.version}</small>
      </div>
      <div aria-label={predicate} className="knowledge-edge-direction">
        <i aria-hidden="true" />
        <b>{predicate}</b>
        <i aria-hidden="true" />
      </div>
      <div className="knowledge-edge-target">
        <span>{displayKind(target.kind)}</span>
        <strong>{target.name}</strong>
        <small>V{target.version}</small>
      </div>
      <p>
        Declared by {declaredBy.name} V{declaredBy.version}. Exact version pin. No semantic
        relationship is inferred.
      </p>
    </li>
  );
}

const knowledgeTypes: Record<KnowledgeType, KnowledgeTypeDefinition> = {
  people: {
    number: '01',
    label: 'People',
    description: 'Owners, approvers, and on-call relationships.',
    kinds: [],
    transferRequired: true,
  },
  systems: {
    number: '02',
    label: 'Systems',
    description: 'Governed Plugin and Plugin Pack definitions.',
    kinds: ['Plugin', 'PluginPack'],
  },
  projects: {
    number: '03',
    label: 'Projects',
    description: 'Governed project boundaries and their exact dependency edges.',
    kinds: ['Project'],
  },
  decisions: {
    number: '04',
    label: 'Decisions',
    description: 'Protocols and references that explain why the system behaves as it does.',
    kinds: ['Protocol'],
  },
  datasets: {
    number: '05',
    label: 'Datasets',
    description: 'Versioned knowledge sources and their exact dependants.',
    kinds: ['KnowledgeSource'],
  },
  runbooks: {
    number: '06',
    label: 'Runbooks',
    description: 'Reference procedures imported from the governed repository.',
    kinds: ['Reference'],
  },
  incidents: {
    number: '07',
    label: 'Incidents',
    description: 'Observed operational signals. Incident-system linkage arrives after transfer.',
    kinds: [],
  },
  metrics: {
    number: '08',
    label: 'Metrics',
    description: 'Definitions that give every reported number one governed meaning.',
    kinds: ['MetricDefinition'],
  },
  agents: {
    number: '09',
    label: 'Agents & Skills',
    description: 'Reusable capability and the skills it closes over.',
    kinds: ['Agent', 'Skill'],
  },
};

const typeEntries = Object.entries(knowledgeTypes) as Array<
  [KnowledgeType, KnowledgeTypeDefinition]
>;
const emptyResources: readonly ResourceVersion[] = [];

function displayKind(kind: ResourceVersion['kind']) {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function resourcePinKey(value: Pick<ResourceVersion, 'familyId' | 'version'>): string {
  return `${value.familyId}@${value.version}`;
}

function dependencyClosure(
  root: ResourceVersion,
  resources: readonly ResourceVersion[],
): Set<string> {
  const byExactPin = new Map(resources.map((resource) => [resourcePinKey(resource), resource]));
  const visited = new Set<string>();
  const pending = [...root.dependencyPins.map(resourcePinKey)];
  while (pending.length > 0) {
    const exactPin = pending.pop();
    if (!exactPin || visited.has(exactPin)) continue;
    visited.add(exactPin);
    const dependency = byExactPin.get(exactPin);
    dependency?.dependencyPins.forEach((pin) => pending.push(resourcePinKey(pin)));
  }
  return visited;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function KnowledgePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawType = searchParams.get('type');
  const selectedType =
    rawType !== null && Object.hasOwn(knowledgeTypes, rawType) ? (rawType as KnowledgeType) : null;
  const selectedEntityId = searchParams.get('entity');
  const resources = usePlatformResources({ limit: 100 });
  const exactResource = usePlatformResource(selectedEntityId);
  const observations = useObservations();
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });
  const grants = useAuthorityGrants({ state: 'active', limit: 100 });
  const items = useMemo(
    () =>
      resources.isError
        ? emptyResources
        : distinctResourceVersions(resources.data?.items ?? emptyResources),
    [resources.data?.items, resources.isError],
  );
  const graphItems = useMemo(() => {
    if (exactResource.isError || exactResource.data === undefined) return items;
    if (isQuarantinedResource(exactResource.data)) return items;
    return items.some((item) => item.id === exactResource.data.id)
      ? items
      : [exactResource.data, ...items];
  }, [exactResource.data, exactResource.isError, items]);
  const selectedDefinition = selectedType ? knowledgeTypes[selectedType] : null;
  const selectedItems = useMemo(
    () =>
      selectedDefinition
        ? graphItems.filter((resource) => selectedDefinition.kinds.includes(resource.kind))
        : [],
    [graphItems, selectedDefinition],
  );
  const selectedResource =
    selectedEntityId !== null && !exactResource.isError
      ? (selectedItems.find((item) => item.id === selectedEntityId) ?? null)
      : null;
  const indexIsPartial =
    !resources.isError && resources.data !== undefined && resources.data.total > items.length;
  const counts = useMemo(
    () =>
      Object.fromEntries(
        typeEntries.map(([key, definition]) => [
          key,
          key === 'incidents'
            ? observations.isError
              ? null
              : (observations.data?.items.length ?? 0)
            : definition.transferRequired
              ? null
              : resources.isError
                ? null
                : items.filter((resource) => definition.kinds.includes(resource.kind)).length,
        ]),
      ) as Record<KnowledgeType, number | null>,
    [items, observations.data?.items.length, observations.isError, resources.isError],
  );

  const relatedResources = useMemo<DefinitionRelationship[]>(() => {
    if (!selectedResource) return [];
    const selectedKey = resourcePinKey(selectedResource);
    const exactDependencies = new Set(selectedResource.dependencyPins.map(resourcePinKey));
    const relationships: DefinitionRelationship[] = [];
    for (const resource of graphItems) {
      if (exactDependencies.has(resourcePinKey(resource))) {
        relationships.push({
          declaredBy: selectedResource,
          predicate: 'DEPENDS ON',
          source: selectedResource,
          target: resource,
        });
        continue;
      }
      if (
        resource.dependencyPins.some((dependency) => resourcePinKey(dependency) === selectedKey)
      ) {
        relationships.push({
          declaredBy: resource,
          predicate: 'USED BY',
          source: selectedResource,
          target: resource,
        });
      }
    }
    return relationships;
  }, [graphItems, selectedResource]);

  const touchingAgents = useMemo(() => {
    if (!selectedResource) return [];
    return graphItems.filter(
      (resource) =>
        resource.kind === 'Agent' &&
        dependencyClosure(resource, graphItems).has(resourcePinKey(selectedResource)),
    );
  }, [graphItems, selectedResource]);

  const selectedAgentCapabilities = useMemo<AgentConnectorCapability[]>(() => {
    if (selectedResource?.kind !== 'Agent' || plugins.isError || grants.isError) return [];
    const spec = objectValue(selectedResource.definition.spec);
    const toolValues = Array.isArray(spec?.['tools']) ? spec['tools'] : [];
    return toolValues.flatMap((toolValue, index) => {
      const tool = objectValue(toolValue);
      const pluginReference = objectValue(tool?.['plugin']);
      const familyId =
        typeof pluginReference?.['familyId'] === 'string' ? pluginReference['familyId'] : null;
      const version =
        typeof pluginReference?.['version'] === 'string' ? pluginReference['version'] : null;
      const toolName = typeof tool?.['tool'] === 'string' ? tool['tool'] : null;
      if (!familyId || !version || !toolName) return [];
      const plugin = plugins.data?.items.find(
        (item) => item.familyId === familyId && item.version === version,
      );
      const capability = plugin?.capabilities.find((item) => item.tool === toolName);
      if (!plugin || !capability) return [];
      const granted = grants.data?.items.some(
        (grant) =>
          grant.entryResourceVersionId === selectedResource.id &&
          grant.pluginScopes.some(
            (scope) => scope.pluginVersionId === plugin.pluginVersionId && scope.tool === toolName,
          ),
      );
      return [
        {
          id: `${plugin.pluginVersionId}:${toolName}:${index}`,
          name: plugin.name,
          detail: capability.scopeDescription,
          effect: capability.effect,
          authority: granted ? 'granted' : 'declared',
          brand: plugin.brand,
        } satisfies AgentConnectorCapability,
      ];
    });
  }, [grants.data?.items, grants.isError, plugins.data?.items, plugins.isError, selectedResource]);

  function chooseType(type: KnowledgeType) {
    setSearchParams({ type });
  }

  function chooseEntity(resource: ResourceVersion) {
    if (!selectedType) return;
    setSearchParams({ type: selectedType, entity: resource.id });
  }

  return (
    <main className="os-surface knowledge-surface">
      <SurfaceHeader
        description="Traverse governed definitions and exact dependency edges already present in the repository. Semantic organizational knowledge remains disconnected until transfer."
        kicker="TYPED DEFINITION GRAPH · TRANSFER BOUNDARY"
        stateDetail="VERSIONED SOURCES · EXACT DEPENDENCIES"
        title="Knowledge"
      />
      {resources.isError ? (
        <Notice tone="error">
          Knowledge definitions unavailable. {getErrorMessage(resources.error)}
        </Notice>
      ) : null}
      {selectedEntityId !== null && exactResource.isError ? (
        <Notice tone="error">
          Requested knowledge entity unavailable. {getErrorMessage(exactResource.error)}
        </Notice>
      ) : null}
      {selectedEntityId !== null &&
      exactResource.data !== undefined &&
      isQuarantinedResource(exactResource.data) ? (
        <Notice tone="info">
          This audit-only fixture is excluded from the user-facing knowledge index.
        </Notice>
      ) : null}
      {indexIsPartial ? (
        <Notice tone="info">
          Knowledge relationship index is partial: {items.length} of {resources.data.total}{' '}
          definitions are loaded. No missing relationship is inferred.
        </Notice>
      ) : null}
      <section aria-label="Knowledge entity types" className="knowledge-type-grid">
        {typeEntries.map(([key, definition]) => (
          <button
            aria-pressed={selectedType === key}
            className="knowledge-type-card"
            key={key}
            onClick={() => chooseType(key)}
            type="button"
          >
            <span className="knowledge-drafting-mark" data-mark={key}>
              {definition.number}
            </span>
            <span>
              <strong>{definition.label}</strong>
              <small>{definition.description}</small>
            </span>
            <em>{counts[key] === null ? 'TRANSFER' : `${counts[key]} SHOWN`}</em>
          </button>
        ))}
      </section>

      {selectedType ? (
        <section className="knowledge-browser" aria-labelledby="knowledge-list-title">
          <header>
            <div>
              <span>{selectedDefinition?.number} · ENTITY INDEX</span>
              <h2 id="knowledge-list-title">{selectedDefinition?.label}</h2>
            </div>
            <button className="secondary-button" onClick={() => setSearchParams({})} type="button">
              CLOSE INDEX
            </button>
          </header>

          {selectedType === 'people' ? (
            <div className="knowledge-transfer-state">
              <strong>People directory is not connected on this machine.</strong>
              <p>
                The interface is ready for owners, approvers, and on-call relationships. Identity
                membership remains database-owned and no private directory data is inferred here.
              </p>
            </div>
          ) : null}
          {selectedType === 'incidents' ? (
            observations.isError ? (
              <Notice tone="error">Operational observations unavailable.</Notice>
            ) : (
              <div className="knowledge-entity-list">
                {(observations.data?.items ?? []).map((observation) => (
                  <article key={observation.id}>
                    <span>OBSERVATION · {humanizeOperationalSignal(observation.signalType)}</span>
                    <h3>{observation.summary}</h3>
                    <small>{new Date(observation.observedAt).toLocaleString()}</small>
                  </article>
                ))}
                {!observations.isLoading && observations.data?.items.length === 0 ? (
                  <div className="knowledge-transfer-state">
                    <strong>No operational observations are visible.</strong>
                    <p>Incident-system records will be linked only after a governed transfer.</p>
                  </div>
                ) : null}
              </div>
            )
          ) : null}
          {selectedDefinition && selectedDefinition.kinds.length > 0 ? (
            <div className="knowledge-browser-grid">
              <div className="knowledge-entity-list">
                {resources.isLoading ? <p role="status">Reading governed entities…</p> : null}
                {!resources.isLoading &&
                !resources.isError &&
                !indexIsPartial &&
                selectedItems.length === 0 ? (
                  <div className="knowledge-transfer-state">
                    <strong>No {selectedDefinition.label.toLocaleLowerCase()} are imported.</strong>
                    <p>The surface is ready; Git remains the definition authority.</p>
                  </div>
                ) : null}
                {selectedItems.map((resource) => (
                  <button
                    aria-pressed={selectedResource?.id === resource.id}
                    key={resource.id}
                    onClick={() => chooseEntity(resource)}
                    type="button"
                  >
                    <span>{displayKind(resource.kind)}</span>
                    <strong>{resource.name}</strong>
                    <small>V{resource.version}</small>
                    <small>{resource.purpose}</small>
                  </button>
                ))}
              </div>
              <aside className="knowledge-relationship-panel">
                {selectedEntityId && exactResource.isLoading ? (
                  <p role="status">Reading the exact resource version…</p>
                ) : null}
                {selectedResource ? (
                  <>
                    <span>
                      {displayKind(selectedResource.kind)} · V{selectedResource.version}
                    </span>
                    <h3>{selectedResource.name}</h3>
                    <p>{selectedResource.purpose}</p>
                    <dl>
                      <div>
                        <dt>OWNER</dt>
                        <dd>{selectedResource.owner}</dd>
                      </div>
                      <div>
                        <dt>LIFECYCLE</dt>
                        <dd>{selectedResource.lifecycle}</dd>
                      </div>
                      <div>
                        <dt>EXACT LINKS</dt>
                        <dd>{relatedResources.length}</dd>
                      </div>
                      <div>
                        <dt>AGENTS THAT TOUCH IT</dt>
                        <dd>{touchingAgents.length}</dd>
                      </div>
                    </dl>
                    <h4>Version-pinned definition edges</h4>
                    {relatedResources.length > 0 ? (
                      <ul className="knowledge-edge-list">
                        {relatedResources.map((relationship) => (
                          <DefinitionEdge
                            key={`${relationship.predicate}:${relationship.source.id}:${relationship.target.id}`}
                            relationship={relationship}
                          />
                        ))}
                      </ul>
                    ) : (
                      <p>No exact dependency relationship is visible in this loaded index.</p>
                    )}
                    <h4>Agents that work on this entity</h4>
                    {touchingAgents.length > 0 ? (
                      <ul>
                        {touchingAgents.map((agent) => (
                          <li key={agent.id}>
                            <strong>{agent.name}</strong>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No imported Agent closes over this entity.</p>
                    )}
                    {selectedResource.kind === 'Agent' ? (
                      <>
                        <h4>Knowledge and authority</h4>
                        {plugins.isError || grants.isError ? (
                          <Notice tone="error">Connector authority is unavailable.</Notice>
                        ) : selectedAgentCapabilities.length > 0 ? (
                          <AgentCapabilitySchematic
                            agentName={selectedResource.name}
                            capabilities={selectedAgentCapabilities}
                          />
                        ) : (
                          <p>This Agent declares no exact Plugin tools in the loaded definition.</p>
                        )}
                      </>
                    ) : null}
                  </>
                ) : (
                  <div className="knowledge-transfer-state">
                    <strong>Select an entity to traverse it.</strong>
                    <p>
                      Relationships come from exact immutable dependency pins, never name matching.
                    </p>
                  </div>
                )}
              </aside>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="knowledge-orientation">
          <div>
            <span>PRIVATE KNOWLEDGE BOUNDARY</span>
            <h2>The definition graph is ready. Semantic organization data is not here yet.</h2>
            <p>
              Transfer will stage people, systems, datasets, runbooks, and incidents through
              extraction and identity resolution before any typed relationship becomes canonical.
              This public workstation exposes only synthetic, versioned definitions.
            </p>
          </div>
          {featureFlags.aimEnabled ? (
            <div>
              <span>SYNTHETIC PROGRAM VIEW</span>
              <h2>AIM demonstrates a separate synthetic capability map.</h2>
              <p>
                Inspect the local capability manifest without live manufacturing data or external
                requests.
              </p>
              <Link className="secondary-button" to="/aim">
                OPEN AIM →
              </Link>
            </div>
          ) : (
            <div>
              <span>CAPABILITY VIEW DISABLED</span>
              <h2>AIM remains outside this build.</h2>
              <p>Enable the local AIM build flag to include the synthetic capability map.</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
