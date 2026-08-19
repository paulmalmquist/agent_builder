import type { PluginCatalogItem } from '../../api/client';

export function hasGovernedRuntime(plugin: PluginCatalogItem): boolean {
  return plugin.transport === 'http' && plugin.executionPlacement === 'control_plane';
}
