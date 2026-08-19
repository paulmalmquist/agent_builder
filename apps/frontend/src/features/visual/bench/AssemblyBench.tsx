import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  useAgentDetail,
  useAuthorityGrants,
  usePlatformResources,
  usePluginInstallations,
  usePlugins,
} from '../../../api/hooks';
import {
  AgentCapabilitySchematic,
  type AgentConnectorCapability,
} from '../../../components/connector-marks/AgentCapabilitySchematic';
import { ConnectorMark } from '../../../components/connector-marks/ConnectorMark';
import { createAssemblyBenchModel } from './bench-model';
import { createBenchScene } from './scene';
import type { AssemblyBenchModel, BenchCapability } from './types';
import './assembly-bench.css';

type SceneState = 'probing' | 'ready' | 'unavailable' | 'error';

const RESOURCE_SEARCH_LIMIT = 100;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function stateLabel(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase();
}

function authorityLabel(capability: BenchCapability): string {
  if (capability.authority === 'granted') return 'GRANTED · IN THE CIRCUIT';
  if (capability.authority === 'declared') return 'DECLARED · NOT GRANTED';
  return 'AUTHORITY UNAVAILABLE · FAIL CLOSED';
}

function connectorLabel(capability: BenchCapability): string {
  if (capability.connectorState === 'healthy') return 'CONNECTOR HEALTHY';
  if (capability.connectorState === 'not_installed') return 'CONNECTOR NOT INSTALLED';
  return `CONNECTOR ${stateLabel(capability.connectorState)}`;
}

function dataLabel(model: AssemblyBenchModel): string {
  if (model.manifestSource === 'fixture') return 'FIXTURE DATA';
  if (model.provenance === 'synthetic') return 'SYNTHETIC MANIFEST';
  if (model.manifestSource === 'governed_resource') return 'CURRENT GOVERNED MANIFEST';
  return 'CURRENT BUILDER MANIFEST · PROVENANCE UNAVAILABLE';
}

function manifestOutput(model: AssemblyBenchModel): string {
  const manifest = model.manifest;
  if ('outputType' in manifest) return stateLabel(manifest.outputType);
  const executionLoop = manifest.spec['executionLoop'];
  if (executionLoop && typeof executionLoop === 'object' && !Array.isArray(executionLoop)) {
    const outputContract = executionLoop['outputContract'];
    if (typeof outputContract === 'string') return outputContract;
  }
  return 'DECLARED OUTPUT';
}

function declaredTriggerCount(model: AssemblyBenchModel): number {
  const manifest = model.manifest;
  if ('workflow' in manifest) return manifest.workflow.length > 0 ? 1 : 0;
  const triggers = manifest.spec['triggers'];
  return Array.isArray(triggers) ? triggers.length : 0;
}

function declaredEvaluationCount(model: AssemblyBenchModel): number | null {
  return 'evaluations' in model.manifest ? model.manifest.evaluations.length : null;
}

function schematicCapabilities(
  capabilities: readonly BenchCapability[],
): AgentConnectorCapability[] {
  return capabilities.flatMap((capability) =>
    capability.authority === 'unavailable'
      ? []
      : [
          {
            authority: capability.authority,
            brand: capability.brand,
            detail: `${capability.detail} ${connectorLabel(capability).toLocaleLowerCase()}.`,
            effect: capability.effect,
            id: capability.id,
            name: capability.name,
          },
        ],
  );
}

function BenchNodeMap({ model }: { model: AssemblyBenchModel }) {
  const writeCapability = model.capabilities.find(
    ({ effect }) => effect === 'write' || effect === 'destructive',
  );
  const workstationCount = model.capabilities.filter(
    ({ executionPlacement }) => executionPlacement === 'workstation',
  ).length;
  const currentTier = /^R[0-4]$/u.test(model.authorityClass?.toUpperCase() ?? '')
    ? model.authorityClass?.toUpperCase()
    : null;
  return (
    <div aria-label="Manifest wiring" className="assembly-bench-node-map">
      <article className="assembly-bench-node assembly-bench-trigger-node">
        <span className="assembly-bench-monogram">TR</span>
        <div>
          <strong>Declared triggers</strong>
          <small>{declaredTriggerCount(model)} IN THE CURRENT MANIFEST</small>
        </div>
      </article>

      <article className="assembly-bench-node assembly-bench-agent-node">
        <header>
          <span className="assembly-bench-monogram">AG</span>
          <div>
            <strong>{model.agentName}</strong>
            <small>{model.department}</small>
          </div>
          <span className="assembly-bench-tier">
            {model.authorityClass
              ? stateLabel(model.authorityClass)
              : 'AUTHORITY CLASS UNAVAILABLE'}
          </span>
        </header>
        <div className="assembly-bench-ports">
          {model.capabilities.map((capability) => (
            <span
              data-authority={capability.authority}
              data-effect={capability.effect}
              key={capability.id}
            >
              <i aria-hidden="true" />
              <b>{capability.name}</b>
              <small>{authorityLabel(capability)}</small>
            </span>
          ))}
        </div>
        <footer>
          <span>AUDIT · ALWAYS</span>
          <span>{stateLabel(model.certificationHealth)}</span>
        </footer>
      </article>

      <aside aria-label="Declared authority tier" className="assembly-bench-tier-ladder">
        {[4, 3, 2, 1, 0].map((tier) => {
          const label = `R${tier}`;
          const selected = currentTier === label;
          return (
            <span aria-current={selected ? 'true' : undefined} key={label}>
              {label}
              {selected ? ' · DECLARED' : ''}
            </span>
          );
        })}
        {currentTier === null ? <small>NO TIER DECLARED</small> : null}
      </aside>

      <div className="assembly-bench-connector-rack" aria-label="Declared connectors">
        <p>CONTROL PLANE AND WORKSTATION CONNECTORS</p>
        {model.capabilities.map((capability) => (
          <article
            className="assembly-bench-node assembly-bench-connector-node"
            data-connector-state={capability.connectorState}
            key={capability.id}
          >
            <ConnectorMark
              active={capability.authority === 'granted' && capability.connectorState === 'healthy'}
              definition={capability.brand}
              label={capability.name}
            />
            <div>
              <strong>{capability.name}</strong>
              <small>{connectorLabel(capability)}</small>
              <small>{authorityLabel(capability)}</small>
            </div>
            <span data-effect={capability.effect}>{stateLabel(capability.effect)}</span>
          </article>
        ))}
      </div>

      <article className="assembly-bench-node assembly-bench-output-node">
        <span className="assembly-bench-monogram">OUT</span>
        <div>
          <strong>{manifestOutput(model)}</strong>
          <small>MANIFEST OUTPUT CONTRACT</small>
        </div>
      </article>

      <aside className="assembly-bench-broker-pane">
        <strong>WORKSTATION · VIA BROKER</strong>
        <span>BROKER STATE NOT EXPOSED</span>
        <small>
          {workstationCount} workstation {workstationCount === 1 ? 'connector' : 'connectors'}{' '}
          declared. Device certificate and user-token state are unavailable here.
        </small>
      </aside>

      {writeCapability ? (
        <div className="assembly-bench-ring-copy">
          <span aria-hidden="true" />
          <strong>HUMAN APPROVAL RING</strong>
          <small>
            {writeCapability.approvalRequired
              ? 'This write is declared approval-required.'
              : 'Approval requirement is not declared by the connector.'}
          </small>
        </div>
      ) : null}
    </div>
  );
}

function FlatBenchFallback({ model, reason }: { model: AssemblyBenchModel; reason: string }) {
  const capabilities = schematicCapabilities(model.capabilities);
  const unavailable = model.capabilities.filter(({ authority }) => authority === 'unavailable');
  return (
    <section className="assembly-bench-flat" data-testid="assembly-bench-flat-fallback">
      <div>
        <p className="page-kicker">FLAT VIEW · COMPLETE TEXT SCHEMATIC</p>
        <h2>{model.agentName} — knows / can do</h2>
        <p>{reason} The manifest and every available authority reading remain below.</p>
      </div>
      <AgentCapabilitySchematic agentName={model.agentName} capabilities={capabilities} />
      {unavailable.length > 0 ? (
        <section
          aria-label="Capabilities with unavailable authority"
          className="assembly-bench-unknown"
        >
          <h3>Authority unavailable</h3>
          <ul>
            {unavailable.map((capability) => (
              <li key={capability.id}>
                <strong>{capability.name}</strong>
                <span>{capability.detail}</span>
                <small>{connectorLabel(capability)} · FAIL CLOSED</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

export function AssemblyBench({ model }: { model: AssemblyBenchModel }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [sceneState, setSceneState] = useState<SceneState>('probing');
  const [sceneError, setSceneError] = useState<string | null>(null);
  const sceneInput = useMemo(
    () => ({
      capabilities: model.capabilities.map(
        ({ approvalRequired, authority, connectorState, effect, executionPlacement }) => ({
          approvalRequired,
          authority,
          connectorState,
          effect,
          executionPlacement,
        }),
      ),
      reducedMotion,
    }),
    [model.capabilities, reducedMotion],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (model.capabilities.length === 0) {
      setSceneState('unavailable');
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (navigator.userAgent.toLocaleLowerCase().includes('jsdom')) {
      setSceneState('unavailable');
      return;
    }
    let scene: ReturnType<typeof createBenchScene> = null;
    let sceneDestroyed = false;
    const destroyScene = () => {
      if (sceneDestroyed) return;
      sceneDestroyed = true;
      scene?.destroy();
      scene = null;
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      destroyScene();
      setSceneError('WebGL context lost.');
      setSceneState('error');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    try {
      scene = createBenchScene(canvas, sceneInput);
      if (!scene) {
        setSceneState('unavailable');
      } else {
        setSceneError(null);
        setSceneState('ready');
      }
    } catch (error) {
      setSceneError(error instanceof Error ? error.message : 'WebGL initialization failed.');
      setSceneState('error');
    }
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      destroyScene();
    };
  }, [model.capabilities.length, sceneInput]);

  const fallbackReason =
    sceneError === 'WebGL context lost.'
      ? 'The WebGL context was lost, so Paul OS is showing the complete flat view.'
      : sceneState === 'error'
        ? 'The WebGL scene could not start, so Paul OS is showing the complete flat view.'
        : model.capabilities.length === 0
          ? 'This manifest does not expose exact governed connector wiring.'
          : 'WebGL is unavailable, so Paul OS is showing the complete flat view.';

  return (
    <main className="assembly-bench" data-source={model.manifestSource}>
      <header className="assembly-bench-heading">
        <div>
          <p className="page-kicker">PAUL OS · ASSEMBLY BENCH · READ ONLY</p>
          <h1>See what this agent knows and can do.</h1>
          <p>
            Inspect the current manifest, connector availability, and authority bound to{' '}
            <strong>{model.agentName}</strong>. {model.readOnlyReason}
          </p>
        </div>
        <div className="assembly-bench-source-state">
          <span>{dataLabel(model)}</span>
          <small>{model.capabilities.length} EXACT CONNECTOR READINGS</small>
        </div>
      </header>

      {model.issues.length > 0 ? (
        <section aria-label="Unavailable bench readings" className="assembly-bench-issues">
          <strong>PARTIAL READ-ONLY VIEW</strong>
          <ul>
            {model.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="assembly-bench-toolbar" aria-label="Bench state">
        <span>MANIFEST DRIVES THE SCENE</span>
        <span>NO DIRECT MUTATIONS</span>
        <span>{reducedMotion ? 'REDUCED MOTION · FINAL STATE' : 'PACKET SETTLE · THEN SLEEP'}</span>
        <button
          disabled
          title="This read-only pass does not call an execution endpoint."
          type="button"
        >
          DRY RUN · NOT CONNECTED
          {declaredEvaluationCount(model) === null
            ? ''
            : ` · ${declaredEvaluationCount(model)} DECLARED CASES`}
        </button>
      </div>

      <section className="assembly-bench-workspace">
        <div className="assembly-bench-stage">
          {sceneState === 'unavailable' || sceneState === 'error' ? (
            <FlatBenchFallback model={model} reason={fallbackReason} />
          ) : (
            <div className="assembly-bench-scene" data-scene-state={sceneState}>
              <canvas aria-hidden="true" data-testid="assembly-bench-webgl" ref={canvasRef} />
              <BenchNodeMap model={model} />
              {sceneState === 'probing' ? (
                <span className="assembly-bench-probing">CHECKING WEBGL…</span>
              ) : null}
            </div>
          )}
        </div>

        <aside aria-label="Current manifest" className="assembly-bench-manifest">
          <header>
            <div>
              <strong>MANIFEST · CURRENT</strong>
              <small>VALID YAML 1.2 · JSON FORM</small>
            </div>
            <span>{dataLabel(model)}</span>
          </header>
          <pre data-testid="assembly-bench-manifest">{model.manifestText}</pre>
        </aside>
      </section>

      <footer className="assembly-bench-legend">
        <span>
          <i data-line="solid" /> Granted — in the circuit
        </span>
        <span>
          <i data-line="dashed" /> Declared, not granted or unavailable
        </span>
        <span>
          <i data-effect="read" /> Hollow terminal — read
        </span>
        <span>
          <i data-effect="write" /> Filled terminal — write or destructive
        </span>
        <p>
          Authority and connector state are repeated in text. Color and wire shape never carry the
          decision alone.
        </p>
      </footer>
      {sceneError ? <span className="sr-only">WebGL error: {sceneError}</span> : null}
    </main>
  );
}

function AssemblyBenchUnavailable({
  agentName,
  reason,
}: {
  agentName?: string;
  reason?: string | undefined;
}) {
  const name = agentName ?? 'this agent';
  return (
    <main className="assembly-bench assembly-bench-unavailable">
      <p className="page-kicker">PAUL OS · ASSEMBLY BENCH · READ ONLY</p>
      <h1>The assembly bench is unavailable.</h1>
      <p>
        {reason ??
          `${name} has no current manifest that this console can verify. The bench will not infer tools, connectors, or authority from a display name.`}
      </p>
      <AgentCapabilitySchematic agentName={name} capabilities={[]} />
    </main>
  );
}

export function AssemblyBenchEntry({ agentId }: { agentId: string }) {
  const detail = useAgentDetail(agentId);
  const agent = detail.data;
  const resourceFilters = useMemo(
    () => ({ kind: 'Agent' as const, limit: RESOURCE_SEARCH_LIMIT, query: agent?.slug ?? '' }),
    [agent?.slug],
  );
  const resources = usePlatformResources(resourceFilters, agent !== undefined);
  const resourceQueryComplete =
    resources.data !== undefined && resources.data.items.length < RESOURCE_SEARCH_LIMIT;
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });
  const installations = usePluginInstallations();
  const grants = useAuthorityGrants({ state: 'active', limit: 100 });
  const model = useMemo(
    () =>
      agent
        ? createAssemblyBenchModel({
            agent,
            grants: grants.data,
            installations: installations.data?.items,
            plugins: plugins.data?.items,
            resourceQueryComplete,
            resources: resources.data?.items,
          })
        : null,
    [
      agent,
      grants.data,
      installations.data?.items,
      plugins.data?.items,
      resourceQueryComplete,
      resources.data?.items,
    ],
  );
  const waiting =
    detail.isLoading ||
    (agent !== undefined && resources.isLoading) ||
    plugins.isLoading ||
    installations.isLoading ||
    grants.isLoading;

  if (waiting) {
    return (
      <main aria-busy="true" className="assembly-bench assembly-bench-loading">
        <p className="page-kicker">PAUL OS · ASSEMBLY BENCH · READ ONLY</p>
        <h1>Loading the exact agent manifest…</h1>
        <p>Connector and grant readings remain unavailable until their governed records load.</p>
      </main>
    );
  }
  if (!agent || detail.isError) return <AssemblyBenchUnavailable />;
  if (!model) {
    const reason =
      resources.data !== undefined && !resourceQueryComplete
        ? `The governed Agent search reached its ${RESOURCE_SEARCH_LIMIT}-result limit. Even a visible match cannot be accepted until the console can prove the result is unique.`
        : resources.isError
          ? 'The governed Agent resource lookup is unavailable. The bench will not infer a manifest or authority from the Builder record alone.'
          : undefined;
    return <AssemblyBenchUnavailable agentName={agent.name} reason={reason} />;
  }

  const queryIssues = [
    resources.isError ? 'The governed Agent resource lookup is unavailable.' : null,
    plugins.isError
      ? 'The Plugin catalog is unavailable; exact connector metadata stays closed.'
      : null,
    installations.isError
      ? 'Plugin installation detail is unavailable; connector residency may be incomplete.'
      : null,
    grants.isError
      ? 'Active grant state is unavailable; this view does not infer no authority.'
      : null,
  ].filter((issue): issue is string => issue !== null);
  return <AssemblyBench model={{ ...model, issues: [...model.issues, ...queryIssues] }} />;
}

export function AssemblyBenchRoute() {
  const { agentId } = useParams<{ agentId: string }>();
  return agentId ? <AssemblyBenchEntry agentId={agentId} /> : <AssemblyBenchUnavailable />;
}
