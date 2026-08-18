import { usePluginInstallations, usePlugins } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { PluginRegistry } from './PluginRegistry';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

export function ConnectionsPage() {
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });
  const installations = usePluginInstallations();
  const items = plugins.isError ? [] : (plugins.data?.items ?? []);
  const available =
    plugins.data !== undefined &&
    !plugins.isError &&
    installations.data !== undefined &&
    !installations.isError;
  const installed = items.filter((plugin) => plugin.installationId !== null);
  const degraded = items.filter(
    (plugin) => plugin.healthStatus === 'degraded' || plugin.installationState === 'disabled',
  );
  const missingSecrets = items.filter((plugin) => {
    const installation = installations.data?.items.find(
      (item) => item.id === plugin.installationId,
    );
    return plugin.secretSlots.some(
      (slot) =>
        slot.required &&
        !installation?.secretBindings.some(
          (binding) => binding.slot === slot.name && binding.configured,
        ),
    );
  });

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Install typed tools, bind opaque secret references, inspect authority usage, and stop unhealthy calls without exposing connector credentials."
        kicker="GOVERNED EXTERNAL CAPABILITY"
        stateDetail="LOCAL MARKS · FAIL-CLOSED TRANSPORTS"
        title="Connections"
      />
      <InstrumentStrip
        readings={[
          { label: 'INSTALLED SHOWN', value: available ? installed.length : '—' },
          {
            label: 'HEALTHY SHOWN',
            value: available
              ? installed.filter((item) => item.healthStatus === 'healthy').length
              : '—',
          },
          { label: 'DEGRADED SHOWN', value: available ? degraded.length : '—' },
          { label: 'MISSING SECRET REFS SHOWN', value: available ? missingSecrets.length : '—' },
        ]}
      />
      {plugins.isError ? (
        <Notice tone="error">Connections unavailable. {getErrorMessage(plugins.error)}</Notice>
      ) : null}
      {installations.isError ? (
        <Notice tone="error">
          Connection configuration status unavailable. {getErrorMessage(installations.error)}
        </Notice>
      ) : null}
      {plugins.isLoading ? (
        <div className="os-empty-state" role="status">
          Reading governed connections…
        </div>
      ) : null}
      {!plugins.isLoading && !plugins.isError && items.length === 0 ? (
        <div className="os-empty-state">
          <strong>No Plugin definitions are available.</strong>
          <span>Import a certified Plugin manifest to expose its typed tools here.</span>
        </div>
      ) : null}
      {items.length > 0 ? <PluginRegistry plugins={items} /> : null}
      <p className="os-disclosure">
        Only HTTP tools execute in this checkpoint. MCP, CLI, database, and workstation transports
        remain visible but unavailable until their governed runtime exists.
      </p>
    </main>
  );
}
