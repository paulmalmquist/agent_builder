import { useMemo, useState, type FormEvent } from 'react';
import type { PluginCatalogItem } from '../../api/client';
import {
  useCheckPluginHealth,
  useConfigurePluginInstallation,
  useInstallPlugin,
  usePluginUsedBy,
  useSetPluginInstallationState,
  useUninstallPlugin,
} from '../../api/hooks';
import { Modal } from '../../components/Modal';
import { Notice } from '../../components/Notice';
import { ConnectorMark } from '../../components/connector-marks/ConnectorMark';
import { getErrorMessage } from '../../api/client';
import { hasGovernedRuntime } from './plugin-runtime';

function money(value: number) {
  return `$${value.toFixed(value < 1 ? 2 : 0)}`;
}

function time(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never used';
}

function typedCapabilityCount(count: number): string {
  return `${count} typed ${count === 1 ? 'capability' : 'capabilities'}`;
}

function countVerb(count: number): 'is' | 'are' {
  return count === 1 ? 'is' : 'are';
}

function unavailableRuntimeLabel(plugin: PluginCatalogItem): string {
  if (plugin.executionPlacement === 'workstation') return 'WORKSTATION BROKER';
  return `${plugin.transport.toUpperCase()} RUNTIME`;
}

function unavailableRuntimeExplanation(plugin: PluginCatalogItem): string {
  const runtime = unavailableRuntimeLabel(plugin).toLocaleLowerCase();
  return `${runtime} is unavailable in this checkpoint. Invocation and setup are withheld from this console until that governed runtime exists.`;
}

function pluginState(
  plugin: PluginCatalogItem,
): PluginCatalogItem['healthStatus'] | 'disabled' | 'unavailable' {
  if (!hasGovernedRuntime(plugin)) return 'unavailable';
  if (plugin.installationState === 'disabled') return 'disabled';
  return plugin.healthStatus;
}

function PluginCard({ plugin, onManage }: { plugin: PluginCatalogItem; onManage: () => void }) {
  const state = pluginState(plugin);
  const installed = plugin.installationId !== null;
  const runtimeAvailable = hasGovernedRuntime(plugin);
  const active = runtimeAvailable && plugin.installationState === 'enabled' && state === 'healthy';
  const capabilitySummary = typedCapabilityCount(plugin.capabilities.length);
  const capabilityVerb = countVerb(plugin.capabilities.length);
  return (
    <article className="plugin-card" data-health={state}>
      <header>
        <div className="plugin-card-title">
          <ConnectorMark active={active} definition={plugin.brand} label={plugin.name} />
          <span className="plugin-health-dot" aria-hidden="true" />
          <div>
            <h3>{plugin.name}</h3>
            <p>{plugin.slug}</p>
          </div>
        </div>
        <span className="resource-kind">{plugin.transport}</span>
      </header>
      <div className="plugin-card-status">
        <strong>{runtimeAvailable ? state.replaceAll('_', ' ') : 'runtime unavailable'}</strong>
        <span>
          {!runtimeAvailable
            ? `${capabilitySummary} ${capabilityVerb} declared. ${unavailableRuntimeExplanation(plugin)}`
            : installed
              ? `${capabilitySummary} ${capabilityVerb} governed by this installation.`
              : `${capabilitySummary} ${capabilityVerb} ready to install.`}
        </span>
      </div>
      <dl className="plugin-readings">
        <div>
          <dt>LAST USED</dt>
          <dd>{time(plugin.lastUsedAt)}</dd>
        </div>
        <div>
          <dt>COST THIS WEEK</dt>
          <dd>{money(plugin.costThisWeekUsd)}</dd>
        </div>
        <div>
          <dt>ACTIVE SCOPES</dt>
          <dd>{plugin.activeScopeDescriptions.length}</dd>
        </div>
        <div>
          <dt>RESIDENCY</dt>
          <dd>{plugin.executionPlacement.replace('_', ' ')}</dd>
        </div>
      </dl>
      <button
        className={installed ? 'secondary-button' : 'primary-button'}
        disabled={!runtimeAvailable}
        onClick={onManage}
        type="button"
      >
        {!runtimeAvailable
          ? `${unavailableRuntimeLabel(plugin)} UNAVAILABLE`
          : installed
            ? 'MANAGE PLUGIN'
            : 'INSTALL PLUGIN'}
      </button>
    </article>
  );
}

function SecretConfiguration({
  plugin,
  values,
  onChange,
}: {
  plugin: PluginCatalogItem;
  values: Record<string, string>;
  onChange: (slot: string, reference: string) => void;
}) {
  if (plugin.secretSlots.length === 0) {
    return <p className="os-disclosure">This Plugin does not require secret bindings.</p>;
  }
  return (
    <fieldset className="plugin-secret-fields">
      <legend>Secret references</legend>
      <p>
        Enter opaque references such as <code>env://CALENDAR_TOKEN</code>. Secret values never enter
        this form.
      </p>
      {plugin.secretSlots.map((slot) => (
        <label key={slot.name}>
          {slot.name}
          <span>{slot.description}</span>
          <input
            autoComplete="off"
            onChange={(event) => onChange(slot.name, event.target.value)}
            pattern="(?:env|secret-manager|windows-credential|keychain)://[A-Za-z0-9_./:@-]+"
            placeholder={slot.required ? 'Required secret reference' : 'Optional secret reference'}
            required={slot.required}
            spellCheck={false}
            value={values[slot.name] ?? ''}
          />
        </label>
      ))}
    </fieldset>
  );
}

function PluginManagementDialog({
  plugin,
  onClose,
}: {
  plugin: PluginCatalogItem;
  onClose: () => void;
}) {
  const [references, setReferences] = useState<Record<string, string>>({});
  const [rationale, setRationale] = useState(
    plugin.installationId
      ? 'Update this exact Plugin installation after reviewing its governed dependents.'
      : 'Install this exact certified Plugin version for bounded control-plane use.',
  );
  const install = useInstallPlugin();
  const configure = useConfigurePluginInstallation();
  const health = useCheckPluginHealth();
  const setState = useSetPluginInstallationState();
  const uninstall = useUninstallPlugin();
  const usedBy = usePluginUsedBy(plugin.installationId);
  const requiredReferencesReady = plugin.secretSlots
    .filter((slot) => slot.required)
    .every((slot) => references[slot.name]?.trim());
  const bindings = useMemo(
    () =>
      Object.entries(references).flatMap(([slot, reference]) =>
        reference.trim() ? [{ slot, reference: reference.trim() }] : [],
      ),
    [references],
  );
  const error =
    install.error ??
    configure.error ??
    health.error ??
    setState.error ??
    uninstall.error ??
    usedBy.error;
  const pending =
    install.isPending ||
    configure.isPending ||
    health.isPending ||
    setState.isPending ||
    uninstall.isPending;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (plugin.installationId === null) {
      install.mutate(
        { pluginVersionId: plugin.pluginVersionId, secretBindings: bindings },
        { onSuccess: onClose },
      );
      return;
    }
    configure.mutate(
      { installationId: plugin.installationId, value: { secretBindings: bindings, rationale } },
      { onSuccess: onClose },
    );
  }

  const nextAction = plugin.installationState === 'disabled' ? 'enable' : 'disable';
  return (
    <Modal kicker="GOVERNED CONNECTION" onClose={onClose} title={plugin.name}>
      <div className="plugin-dialog-summary">
        <ConnectorMark
          active={plugin.installationState === 'enabled' && pluginState(plugin) === 'healthy'}
          definition={plugin.brand}
          label={plugin.name}
        />
        <span className="resource-kind">{plugin.transport}</span>
        <span className="os-status-chip" data-state={pluginState(plugin)}>
          {pluginState(plugin).replaceAll('_', ' ')}
        </span>
        <span>{plugin.classification} data</span>
        <span>{plugin.executionPlacement.replace('_', ' ')}</span>
      </div>
      <p>
        {typedCapabilityCount(plugin.capabilities.length)} {countVerb(plugin.capabilities.length)}{' '}
        declared. The runtime checks this exact version, digest, installation, scope, schema, and
        effect before every call.
      </p>
      <ul className="plugin-capability-list" aria-label="Plugin capabilities">
        {plugin.capabilities.map((capability) => (
          <li key={capability.tool}>
            <div>
              <strong>{capability.tool}</strong>
              <span>{capability.scopeDescription}</span>
            </div>
            <span data-effect={capability.effect}>{capability.effect}</span>
          </li>
        ))}
      </ul>
      {plugin.activeScopeDescriptions.length > 0 ? (
        <div className="plugin-active-scopes">
          <strong>Currently granted</strong>
          <ul>
            {plugin.activeScopeDescriptions.map((description) => (
              <li key={description}>{description}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {plugin.installationId ? (
        <div className="plugin-used-by" aria-busy={usedBy.isLoading}>
          <strong>Used by</strong>
          {usedBy.isLoading ? <span>Checking exact dependents…</span> : null}
          {usedBy.data?.items.length === 0 ? <span>No governed dependents.</span> : null}
          {usedBy.data?.items.map((item) => (
            <span key={`${item.kind}:${item.id}`}>
              {item.name} · {item.kind} · {item.lifecycle}
            </span>
          ))}
        </div>
      ) : null}
      {error ? <Notice tone="error">{getErrorMessage(error)}</Notice> : null}
      <form className="form-grid" onSubmit={save}>
        {plugin.installationId && plugin.secretSlots.length > 0 ? (
          <Notice>
            Saving replaces every secret binding. Re-enter each required reference; stored values
            are intentionally never returned to the browser.
          </Notice>
        ) : null}
        <SecretConfiguration
          onChange={(slot, reference) =>
            setReferences((current) => ({ ...current, [slot]: reference }))
          }
          plugin={plugin}
          values={references}
        />
        {plugin.installationId ? (
          <label className="full-field">
            Change rationale
            <textarea
              maxLength={2_000}
              minLength={10}
              onChange={(event) => setRationale(event.target.value)}
              required
              value={rationale}
            />
          </label>
        ) : null}
        <div className="plugin-dialog-actions full-field">
          <button className="secondary-button" onClick={onClose} type="button">
            CLOSE
          </button>
          {plugin.installationId ? (
            <button
              className="secondary-button"
              disabled={pending}
              onClick={() => health.mutate(plugin.installationId!)}
              type="button"
            >
              CHECK HEALTH
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={
              pending ||
              !requiredReferencesReady ||
              (plugin.installationId !== null && bindings.length === 0)
            }
            type="submit"
          >
            {plugin.installationId ? 'SAVE SECRET REFERENCES' : 'INSTALL EXACT VERSION'}
          </button>
        </div>
      </form>
      {plugin.installationId ? (
        <div className="plugin-danger-actions">
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() =>
              setState.mutate({
                installationId: plugin.installationId!,
                action: nextAction,
                rationale,
              })
            }
            type="button"
          >
            {nextAction === 'enable' ? 'ENABLE PLUGIN' : 'TRIGGER KILL SWITCH'}
          </button>
          <button
            className="secondary-button"
            disabled={pending || usedBy.data?.uninstallBlocked !== false}
            onClick={() =>
              uninstall.mutate(
                { installationId: plugin.installationId!, rationale },
                { onSuccess: onClose },
              )
            }
            type="button"
          >
            UNINSTALL
          </button>
          {usedBy.data?.uninstallBlocked ? (
            <small>Retire or re-pin every certified dependent before uninstalling.</small>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

export function PluginRegistry({ plugins }: { plugins: PluginCatalogItem[] }) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const ordered = useMemo(
    () =>
      [...plugins].sort((left, right) => {
        const rank = { degraded: 0, unavailable: 1, unknown: 2, disabled: 3, healthy: 4 };
        return (
          rank[pluginState(left)] - rank[pluginState(right)] || left.name.localeCompare(right.name)
        );
      }),
    [plugins],
  );
  const selected = plugins.find((plugin) => plugin.pluginVersionId === selectedVersionId) ?? null;
  return (
    <>
      <div className="plugin-grid">
        {ordered.map((plugin) => (
          <PluginCard
            key={plugin.pluginVersionId}
            onManage={() => setSelectedVersionId(plugin.pluginVersionId)}
            plugin={plugin}
          />
        ))}
      </div>
      {selected ? (
        <PluginManagementDialog onClose={() => setSelectedVersionId(null)} plugin={selected} />
      ) : null}
    </>
  );
}
