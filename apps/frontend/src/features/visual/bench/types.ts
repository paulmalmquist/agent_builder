import type { AgentManifest, ResourceManifest } from '@agent-builder/contracts';
import type { ConnectorMarkDefinition } from '../../../components/connector-marks/ConnectorMark';

export type BenchCapabilityEffect = 'read' | 'write' | 'destructive';
export type BenchAuthorityState = 'granted' | 'declared' | 'unavailable';
export type BenchConnectorState =
  | 'healthy'
  | 'degraded'
  | 'disabled'
  | 'not_installed'
  | 'unavailable';
export type BenchManifest = AgentManifest | ResourceManifest;
export type BenchManifestSource = 'governed_resource' | 'builder_agent' | 'fixture';

export interface BenchCapability {
  approvalRequired: boolean;
  authority: BenchAuthorityState;
  brand: ConnectorMarkDefinition;
  connectorState: BenchConnectorState;
  detail: string;
  effect: BenchCapabilityEffect;
  executionPlacement: 'control_plane' | 'workstation' | 'unavailable';
  id: string;
  name: string;
  tool: string;
}

export interface AssemblyBenchModel {
  agentId: string;
  agentName: string;
  authorityClass: string | null;
  capabilities: readonly BenchCapability[];
  certificationHealth: string;
  department: string;
  issues: readonly string[];
  manifest: BenchManifest;
  manifestSource: BenchManifestSource;
  manifestText: string;
  provenance: 'synthetic' | 'declared' | 'unavailable';
  purpose: string;
  readOnlyReason: string;
  resourceVersionId: string | null;
}

export interface BenchSceneCapability {
  approvalRequired: boolean;
  authority: BenchAuthorityState;
  connectorState: BenchConnectorState;
  effect: BenchCapabilityEffect;
  executionPlacement: BenchCapability['executionPlacement'];
}

export interface BenchSceneInput {
  capabilities: readonly BenchSceneCapability[];
  reducedMotion: boolean;
}

export interface BenchSceneController {
  destroy: () => void;
  wake: () => void;
}
