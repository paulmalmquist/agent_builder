import type { JsonValue } from '@agent-builder/contracts';
import { canonicalJson, sha256 } from './compiler.js';

export const contextSourceOrder = [
  'core',
  'private_profile',
  'business_domain',
  'project',
  'agent',
  'request',
] as const;

export type ContextSource = (typeof contextSourceOrder)[number];

export const contextClassifications = ['public', 'internal', 'private', 'restricted'] as const;
export type ContextClassification = (typeof contextClassifications)[number];

const defaultClassification: Record<ContextSource, ContextClassification> = {
  core: 'public',
  private_profile: 'private',
  business_domain: 'internal',
  project: 'internal',
  agent: 'internal',
  request: 'private',
};

const classificationRank = new Map(
  contextClassifications.map((classification, index) => [classification, index]),
);

export interface ContextProvenance {
  source: ContextSource;
  origin: string;
  resourceVersionId?: string;
  digest?: string;
  observedAt?: string;
  classification: ContextClassification;
  tokenContribution: number;
}

export type ContextLayerProvenance = Omit<
  ContextProvenance,
  'source' | 'classification' | 'tokenContribution'
> & {
  classification?: ContextClassification;
};

export interface ContextLayer {
  source: ContextSource;
  values: Record<string, JsonValue>;
  allow?: readonly string[];
  deny?: readonly string[];
  mandatoryProtocols?: readonly string[];
  provenance: ContextLayerProvenance;
}

export interface AssembledContext {
  values: Record<string, JsonValue>;
  allow: string[];
  deny: string[];
  mandatoryProtocols: string[];
  provenance: ContextProvenance[];
  classification: ContextClassification;
  estimatedTokens: number;
  digest: string;
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function mergeValues(
  lower: Record<string, JsonValue>,
  higher: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const merged: Record<string, JsonValue> = { ...lower };
  for (const [key, value] of Object.entries(higher)) {
    const previous = merged[key];
    merged[key] =
      previous !== undefined && isObject(previous) && isObject(value)
        ? mergeValues(previous, value)
        : value;
  }
  return merged;
}

function stableUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function estimatedTokens(value: JsonValue): number {
  return Math.max(1, Math.ceil(new TextEncoder().encode(canonicalJson(value)).byteLength / 4));
}

function mostRestrictiveClassification(
  left: ContextClassification,
  right: ContextClassification,
): ContextClassification {
  return (classificationRank.get(right) ?? 0) > (classificationRank.get(left) ?? 0) ? right : left;
}

/**
 * Builds the ephemeral context envelope. Input order is deliberately ignored: the platform's
 * precedence table is authoritative, and deny rules and mandatory protocols only accumulate.
 */
export function assembleContext(layers: readonly ContextLayer[]): AssembledContext {
  const seen = new Set<ContextSource>();
  for (const layer of layers) {
    if (seen.has(layer.source)) {
      throw new Error(`Context source ${layer.source} may appear only once`);
    }
    if (layer.provenance.origin.trim().length === 0) {
      throw new Error(`Context source ${layer.source} requires provenance`);
    }
    seen.add(layer.source);
  }

  const ordered = [...layers].sort(
    (left, right) =>
      contextSourceOrder.indexOf(left.source) - contextSourceOrder.indexOf(right.source),
  );
  let values: Record<string, JsonValue> = {};
  let allowed: Set<string> | undefined;
  const denied = new Set<string>();
  const mandatoryProtocols = new Set<string>();
  const provenance: ContextProvenance[] = [];
  let classification: ContextClassification = 'public';
  let totalEstimatedTokens = 0;

  for (const layer of ordered) {
    values = mergeValues(values, layer.values);
    if (layer.allow !== undefined) {
      const layerAllow = new Set(layer.allow);
      allowed =
        allowed === undefined
          ? layerAllow
          : new Set([...allowed].filter((permission) => layerAllow.has(permission)));
    }
    layer.deny?.forEach((permission) => denied.add(permission));
    layer.mandatoryProtocols?.forEach((protocol) => mandatoryProtocols.add(protocol));
    const layerClassification =
      layer.provenance.classification ?? defaultClassification[layer.source];
    const tokenContribution = estimatedTokens(layer.values);
    classification = mostRestrictiveClassification(classification, layerClassification);
    totalEstimatedTokens += tokenContribution;
    provenance.push({
      source: layer.source,
      ...layer.provenance,
      classification: layerClassification,
      tokenContribution,
    });
  }

  for (const permission of denied) allowed?.delete(permission);
  const envelope = {
    values,
    allow: stableUnique(allowed ?? []),
    deny: stableUnique(denied),
    mandatoryProtocols: stableUnique(mandatoryProtocols),
    provenance,
    classification,
    estimatedTokens: totalEstimatedTokens,
  };
  return { ...envelope, digest: sha256(canonicalJson(envelope)) };
}
