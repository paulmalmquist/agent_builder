const GOVERNED_PLUGIN_MARK_SOURCE =
  /^\/v1\/plugins\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/mark\/[a-f0-9]{64}\.svg$/u;

export function isLocalConnectorAssetSource(value: string): boolean {
  return GOVERNED_PLUGIN_MARK_SOURCE.test(value);
}
