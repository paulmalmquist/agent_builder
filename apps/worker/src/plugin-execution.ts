import type { JsonValue } from '@agent-builder/contracts';
import {
  PluginRuntimeError,
  assertScopeNarrowsTool,
  pluginPayloadDigest,
  type PluginAuthorityScopeRuntime,
  type PluginCallResult,
  type PluginEffect,
  type PluginInstallationRuntime,
  type PluginRuntimeDefinition,
  type PluginTransportRegistry,
} from '@paul-os/runtime';

export interface WorkerPluginCall {
  invocationKey: string;
  planId: string;
  requirementId: string;
  runId: string;
  workerId: string;
  releaseId: string;
  releaseDigest: string;
  entryResourceVersionId: string;
  contextDigest: string;
  installationId: string;
  pluginVersionId: string;
  pluginDigest: string;
  tool: string;
  effect: PluginEffect;
  input: JsonValue;
  signal?: AbortSignal;
}

export interface PluginCallAuthorizationSnapshot {
  run: {
    id: string;
    releaseId: string;
    releaseDigest: string;
    entryResourceVersionId: string;
    contextDigest: string;
    cancellationRequested: boolean;
    developmentDraft: boolean;
    pluginApprovalSatisfied: boolean;
    leaseOwner: string | null;
  };
  release: { id: string; digest: string };
  entrypoint: {
    resourceVersionId: string;
    belongsToRelease: boolean;
    pluginReachableThroughDependencies: boolean;
  };
  installation: PluginInstallationRuntime;
  requirement: {
    id: string;
    runId: string;
    installationId: string;
    pluginVersionId: string;
    pluginDigest: string;
    capabilityName: string;
    effect: PluginEffect;
    contextDigest: string;
    executionPlacement: 'control_plane' | 'workstation';
    approvalRequired: boolean;
    authorityScope: PluginAuthorityScopeRuntime;
    state: 'active' | 'cancelled';
  };
  plan: {
    id: string;
    runId: string;
    requirementId: string;
    invocationKey: string;
  };
  authority: {
    state: 'active' | 'revoked' | 'expired' | 'exhausted';
    releaseId: string;
    releaseDigest: string;
    entryResourceVersionId: string;
    contextDigest: string;
    scopes: readonly PluginAuthorityScopeRuntime[];
  };
  definition: PluginRuntimeDefinition;
}

export interface PluginInvocationLedgerEvent {
  invocationKey: string;
  planId: string;
  sequence: 1 | 2;
  runId: string;
  workerId: string;
  installationId: string;
  toolName: string;
  effect: PluginEffect;
  state: 'running' | 'succeeded' | 'failed' | 'cancelled';
  inputDigest: string;
  outputDigest: string | null;
  latencyMs: number | null;
  costUsd: number | null;
  errorCode: string | null;
}

export interface WorkerPluginExecutionStore {
  revalidate(call: WorkerPluginCall): Promise<PluginCallAuthorizationSnapshot>;
  /**
   * Append-only and idempotent by (invocationKey, sequence). Repeating an identical event is a
   * no-op; a different event for an existing key/sequence must fail closed.
   */
  appendInvocation(event: PluginInvocationLedgerEvent): Promise<'inserted' | 'existing'>;
}

export class PluginInvocationPersistenceError extends PluginRuntimeError {
  constructor(readonly cause: unknown) {
    super(
      'PLUGIN_INVOCATION_LEDGER_UNAVAILABLE',
      true,
      'The Plugin invocation result could not be recorded durably.',
    );
    this.name = 'PluginInvocationPersistenceError';
  }
}

function sameAuthorityScope(
  left: PluginAuthorityScopeRuntime,
  right: PluginAuthorityScopeRuntime,
): boolean {
  return (
    left.installationId === right.installationId &&
    left.pluginVersionId === right.pluginVersionId &&
    left.pluginDigest === right.pluginDigest &&
    left.tool === right.tool &&
    left.effect === right.effect &&
    left.scopeDescription === right.scopeDescription &&
    JSON.stringify(left.limits) === JSON.stringify(right.limits)
  );
}

function assertGrantNarrowsRequirement(
  grant: PluginAuthorityScopeRuntime,
  requirement: PluginAuthorityScopeRuntime,
): void {
  if (
    grant.installationId !== requirement.installationId ||
    grant.pluginVersionId !== requirement.pluginVersionId ||
    grant.pluginDigest !== requirement.pluginDigest ||
    grant.tool !== requirement.tool ||
    grant.effect !== requirement.effect
  ) {
    throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SCOPE_MISMATCH', false);
  }
  for (const key of [
    'timeoutMs',
    'maxResponseBytes',
    'maxRecords',
    'maxInvocationsPerRun',
    'maximumBytesBilled',
    'maxEstimatedCostUsd',
  ] as const) {
    const requiredMaximum = requirement.limits[key];
    const grantedMaximum = grant.limits[key];
    if (
      grantedMaximum !== undefined &&
      (requiredMaximum === undefined || grantedMaximum > requiredMaximum)
    ) {
      throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SCOPE_BROADENED', false);
    }
  }
}

function matchingAuthorityScope(
  call: WorkerPluginCall,
  scopes: readonly PluginAuthorityScopeRuntime[],
): PluginAuthorityScopeRuntime {
  const matches = scopes.filter(
    (scope) =>
      scope.pluginVersionId === call.pluginVersionId &&
      scope.pluginDigest === call.pluginDigest &&
      scope.installationId === call.installationId &&
      scope.tool === call.tool,
  );
  if (matches.length !== 1) {
    throw new PluginRuntimeError('PLUGIN_AUTHORITY_SCOPE_MISMATCH', false);
  }
  const scope = matches[0];
  if (scope === undefined || scope.effect !== call.effect) {
    throw new PluginRuntimeError('PLUGIN_EFFECT_ESCALATION', false);
  }
  return scope;
}

export function assertWorkerPluginAuthorization(
  call: WorkerPluginCall,
  snapshot: PluginCallAuthorizationSnapshot,
): PluginAuthorityScopeRuntime {
  if (
    snapshot.run.id !== call.runId ||
    snapshot.run.releaseId !== call.releaseId ||
    snapshot.release.id !== call.releaseId ||
    snapshot.run.releaseDigest !== call.releaseDigest ||
    snapshot.release.digest !== call.releaseDigest
  ) {
    throw new PluginRuntimeError('PLUGIN_RELEASE_SNAPSHOT_MISMATCH', false);
  }
  if (snapshot.run.leaseOwner !== call.workerId) {
    throw new PluginRuntimeError('PLUGIN_RUN_LEASE_LOST', false);
  }
  if (
    snapshot.plan.id !== call.planId ||
    snapshot.plan.runId !== call.runId ||
    snapshot.plan.requirementId !== call.requirementId ||
    snapshot.plan.invocationKey !== call.invocationKey ||
    snapshot.requirement.id !== call.requirementId
  ) {
    throw new PluginRuntimeError('PLUGIN_CALL_PLAN_MISMATCH', false);
  }
  if (
    snapshot.run.entryResourceVersionId !== call.entryResourceVersionId ||
    snapshot.entrypoint.resourceVersionId !== call.entryResourceVersionId ||
    snapshot.authority.entryResourceVersionId !== call.entryResourceVersionId ||
    !snapshot.entrypoint.belongsToRelease ||
    !snapshot.entrypoint.pluginReachableThroughDependencies
  ) {
    throw new PluginRuntimeError('PLUGIN_ENTRYPOINT_AUTHORITY_MISMATCH', false);
  }
  if (
    snapshot.run.contextDigest !== call.contextDigest ||
    snapshot.requirement.contextDigest !== call.contextDigest ||
    snapshot.authority.contextDigest !== call.contextDigest
  ) {
    throw new PluginRuntimeError('PLUGIN_CONTEXT_SNAPSHOT_MISMATCH', false);
  }
  if (snapshot.run.cancellationRequested) {
    throw new PluginRuntimeError('RUN_CANCELLED', false);
  }
  if (snapshot.requirement.approvalRequired && !snapshot.run.pluginApprovalSatisfied) {
    throw new PluginRuntimeError('PLUGIN_PER_RUN_APPROVAL_REQUIRED', false);
  }
  if (snapshot.authority.state !== 'active') {
    throw new PluginRuntimeError('PLUGIN_AUTHORITY_INACTIVE', false);
  }
  if (
    snapshot.authority.releaseId !== call.releaseId ||
    snapshot.authority.releaseDigest !== call.releaseDigest
  ) {
    throw new PluginRuntimeError('PLUGIN_RELEASE_SNAPSHOT_MISMATCH', false);
  }
  const installation = snapshot.installation;
  const requirement = snapshot.requirement;
  const definition = snapshot.definition;
  if (
    installation.id !== call.installationId ||
    requirement.installationId !== call.installationId ||
    requirement.runId !== call.runId ||
    installation.pluginVersionId !== call.pluginVersionId ||
    requirement.pluginVersionId !== call.pluginVersionId ||
    definition.pluginVersionId !== call.pluginVersionId ||
    installation.pluginDigest !== call.pluginDigest ||
    requirement.pluginDigest !== call.pluginDigest ||
    definition.pluginDigest !== call.pluginDigest
  ) {
    throw new PluginRuntimeError('PLUGIN_INSTALLATION_SNAPSHOT_MISMATCH', false);
  }
  if (installation.state !== 'enabled' || requirement.state !== 'active') {
    throw new PluginRuntimeError('PLUGIN_DISABLED', false);
  }
  if (installation.developmentOnly && !snapshot.run.developmentDraft) {
    throw new PluginRuntimeError('PLUGIN_DEVELOPMENT_INSTALLATION_FORBIDDEN', false);
  }
  if (
    installation.placement !== 'control_plane' ||
    requirement.executionPlacement !== 'control_plane' ||
    definition.placement !== 'control_plane'
  ) {
    throw new PluginRuntimeError('PLUGIN_WORKSTATION_UNAVAILABLE', false);
  }
  if (installation.transport !== definition.transport) {
    throw new PluginRuntimeError('PLUGIN_TRANSPORT_MISMATCH', false);
  }
  if (
    requirement.capabilityName !== call.tool ||
    requirement.effect !== call.effect ||
    requirement.authorityScope.pluginVersionId !== call.pluginVersionId ||
    requirement.authorityScope.pluginDigest !== call.pluginDigest ||
    requirement.authorityScope.installationId !== call.installationId ||
    requirement.authorityScope.tool !== call.tool ||
    requirement.authorityScope.effect !== call.effect
  ) {
    throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SNAPSHOT_MISMATCH', false);
  }
  const scope = matchingAuthorityScope(call, snapshot.authority.scopes);
  const tool = definition.tools.find(({ name }) => name === call.tool);
  if (tool === undefined) throw new PluginRuntimeError('PLUGIN_TOOL_NOT_FOUND', false);
  if (tool.effect !== call.effect) throw new PluginRuntimeError('PLUGIN_EFFECT_ESCALATION', false);
  assertScopeNarrowsTool(tool, requirement.authorityScope);
  assertGrantNarrowsRequirement(scope, requirement.authorityScope);
  assertScopeNarrowsTool(tool, scope);
  return scope;
}

function runtimeCode(error: unknown): string {
  return error instanceof PluginRuntimeError ? error.code : 'PLUGIN_RUNTIME_FAILED';
}

function cancelledCode(code: string): boolean {
  return (
    code === 'PLUGIN_DISABLED' ||
    code === 'PLUGIN_AUTHORITY_INACTIVE' ||
    code === 'PLUGIN_AUTHORITY_CHANGED' ||
    code === 'PLUGIN_CALL_CANCELLED' ||
    code === 'RUN_CANCELLED'
  );
}

export class WorkerPluginExecutor {
  constructor(
    private readonly store: WorkerPluginExecutionStore,
    private readonly runtime: PluginTransportRegistry,
    private readonly revalidateIntervalMs = 1_000,
    private readonly terminalLedgerAttempts = 3,
  ) {
    if (revalidateIntervalMs < 10) {
      throw new Error('Plugin revalidation interval must be at least 10ms');
    }
    if (!Number.isInteger(terminalLedgerAttempts) || terminalLedgerAttempts < 1) {
      throw new Error('Plugin terminal ledger attempts must be a positive integer');
    }
  }

  async execute(call: WorkerPluginCall): Promise<PluginCallResult> {
    const initial = await this.store.revalidate(call);
    const initialScope = assertWorkerPluginAuthorization(call, initial);
    const inputDigest = pluginPayloadDigest(call.input);
    const beginResult = await this.store.appendInvocation({
      invocationKey: call.invocationKey,
      planId: call.planId,
      sequence: 1,
      runId: call.runId,
      workerId: call.workerId,
      installationId: call.installationId,
      toolName: call.tool,
      effect: call.effect,
      state: 'running',
      inputDigest,
      outputDigest: null,
      latencyMs: null,
      costUsd: null,
      errorCode: null,
    });
    if (beginResult !== 'inserted') {
      // Sequence one without a terminal record is an ambiguous prior attempt. Never replay a
      // possibly non-idempotent external effect merely because the worker was restarted.
      throw new PluginRuntimeError('PLUGIN_INVOCATION_ALREADY_STARTED', false);
    }

    const controller = new AbortController();
    const signal =
      call.signal === undefined
        ? controller.signal
        : AbortSignal.any([call.signal, controller.signal]);
    let monitoring = true;
    const monitor = this.monitorAuthorization(call, controller, () => monitoring);
    const started = performance.now();
    try {
      // Revalidate after the running ledger event and immediately before the external effect.
      const current = await this.store.revalidate(call);
      const scope = assertWorkerPluginAuthorization(call, current);
      if (!sameAuthorityScope(scope, initialScope)) {
        throw new PluginRuntimeError('PLUGIN_AUTHORITY_CHANGED', false);
      }
      const result = await this.runtime.callTool({
        definition: current.definition,
        installation: current.installation,
        scope,
        tool: call.tool,
        input: call.input,
        signal,
      });
      // A transport may ignore cancellation. Re-read every governed input after it returns so a
      // mid-call disable, revocation, cancellation, or context change can never be called success.
      const completed = await this.store.revalidate(call);
      const completedScope = assertWorkerPluginAuthorization(call, completed);
      if (!sameAuthorityScope(completedScope, initialScope)) {
        throw new PluginRuntimeError('PLUGIN_AUTHORITY_CHANGED', false);
      }
      await this.appendTerminal({
        invocationKey: call.invocationKey,
        planId: call.planId,
        sequence: 2,
        runId: call.runId,
        workerId: call.workerId,
        installationId: call.installationId,
        toolName: call.tool,
        effect: call.effect,
        state: 'succeeded',
        inputDigest,
        outputDigest: pluginPayloadDigest(result.output),
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
        errorCode: null,
      });
      return result;
    } catch (error: unknown) {
      const code = signal.aborted ? runtimeCode(signal.reason) : runtimeCode(error);
      if (error instanceof PluginInvocationPersistenceError) throw error;
      await this.appendTerminal({
        invocationKey: call.invocationKey,
        planId: call.planId,
        sequence: 2,
        runId: call.runId,
        workerId: call.workerId,
        installationId: call.installationId,
        toolName: call.tool,
        effect: call.effect,
        state: cancelledCode(code) ? 'cancelled' : 'failed',
        inputDigest,
        outputDigest: null,
        latencyMs: performance.now() - started,
        costUsd: null,
        errorCode: code,
      });
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new PluginRuntimeError('PLUGIN_CALL_CANCELLED', false);
      }
      throw error;
    } finally {
      monitoring = false;
      if (!controller.signal.aborted) {
        controller.abort(new PluginRuntimeError('PLUGIN_MONITOR_STOPPED', false));
      }
      await monitor;
    }
  }

  private async appendTerminal(event: PluginInvocationLedgerEvent): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.terminalLedgerAttempts; attempt += 1) {
      try {
        await this.store.appendInvocation(event);
        return;
      } catch (error: unknown) {
        if (error instanceof PluginRuntimeError && !error.retryable) throw error;
        lastError = error;
        // Yield between attempts without adding wall-clock retry latency. Store idempotency makes
        // an ambiguous acknowledgement safe: the identical sequence-two event is a no-op.
        if (attempt < this.terminalLedgerAttempts) await Promise.resolve();
      }
    }
    // The external effect may already have happened. Leave sequence one as RUNNING/ambiguous;
    // recovery must reconcile it and must never blindly replay the effect.
    throw new PluginInvocationPersistenceError(lastError);
  }

  private async monitorAuthorization(
    call: WorkerPluginCall,
    controller: AbortController,
    active: () => boolean,
  ): Promise<void> {
    while (active() && !controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.revalidateIntervalMs);
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
      if (!active() || controller.signal.aborted) return;
      try {
        assertWorkerPluginAuthorization(call, await this.store.revalidate(call));
      } catch (error: unknown) {
        controller.abort(
          error instanceof Error
            ? error
            : new PluginRuntimeError('PLUGIN_AUTHORIZATION_REVALIDATION_FAILED', true),
        );
      }
    }
  }
}
