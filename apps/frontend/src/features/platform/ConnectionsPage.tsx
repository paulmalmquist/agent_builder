import { usePluginInstallations, usePlugins } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { PluginRegistry } from './PluginRegistry';
import { hasGovernedRuntime } from './plugin-runtime';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

export function ConnectionsPage() {
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });
  const installations = usePluginInstallations();
  const items = plugins.isError ? [] : (plugins.data?.items ?? []);
  const inventoryAvailable =
    plugins.data !== undefined &&
    !plugins.isError &&
    installations.data !== undefined &&
    !installations.isError;
  const installed = items.filter((plugin) => plugin.installationId !== null);
  const installable = items.filter(
    (plugin) => plugin.installationId === null && hasGovernedRuntime(plugin),
  );
  const unavailable = items.filter((plugin) => !hasGovernedRuntime(plugin));

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
          { label: 'CATALOG CARDS SHOWN', value: inventoryAvailable ? items.length : '—' },
          { label: 'INSTALLED SHOWN', value: inventoryAvailable ? installed.length : '—' },
          { label: 'READY TO INSTALL', value: inventoryAvailable ? installable.length : '—' },
          { label: 'RUNTIME UNAVAILABLE', value: inventoryAvailable ? unavailable.length : '—' },
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
