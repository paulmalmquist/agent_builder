import {
  ApprovalRequestState,
  AuthorityGrantState,
  ExecutionRunState,
  PluginEffect as PrismaPluginEffect,
  PluginInstallationState,
  PluginInvocationState,
  PluginResidency,
  PluginTransport as PrismaPluginTransport,
  Prisma,
  ResourceKind,
  type PrismaClient,
} from '@prisma/client';
import {
  pluginCallInputPathSchema,
  pluginAuthorityScopeSchema,
  pluginResourceSpecSchema,
  resourceManifestSchema,
  runPluginRequirementSchema,
  type JsonValue,
} from '@agent-builder/contracts';
import {
  PluginRuntimeError,
  pluginPayloadDigest,
  pluginRuntimeDefinitionFromSpec,
  type PluginAuthorityScopeRuntime,
  type PluginEffect,
  type PluginInstallationRuntime,
} from '@paul-os/runtime';
import { z } from 'zod';
import type {
  PluginCallAuthorizationSnapshot,
  PluginInvocationLedgerEvent,
  WorkerPluginCall,
  WorkerPluginExecutionStore,
} from './plugin-execution.js';
import type { PlannedWorkerPluginCall, WorkerPluginPlanSource } from './plugin-plan.js';
import type { ClaimedRun } from './types.js';

type ReachabilityRow = {
  belongsToRelease: boolean;
  pluginReachable: boolean;
};

function asJsonValue(input: unknown): JsonValue {
  return input as JsonValue;
}

function sameJson(left: unknown, right: unknown): boolean {
  return pluginPayloadDigest(asJsonValue(left)) === pluginPayloadDigest(asJsonValue(right));
}

function runtimeTransport(value: PrismaPluginTransport): PluginInstallationRuntime['transport'] {
  switch (value) {
    case PrismaPluginTransport.HTTP:
      return 'http';
    case PrismaPluginTransport.MCP:
      return 'mcp';
    case PrismaPluginTransport.CLI:
      return 'cli';
    case PrismaPluginTransport.DB:
      return 'db';
  }
}

function runtimePlacement(value: PluginResidency): PluginInstallationRuntime['placement'] {
  return value === PluginResidency.CONTROL_PLANE ? 'control_plane' : 'workstation';
}

function runtimeInstallationState(
  value: PluginInstallationState,
): PluginInstallationRuntime['state'] {
  switch (value) {
    case PluginInstallationState.INSTALLED:
      return 'installed';
    case PluginInstallationState.ENABLED:
      return 'enabled';
    case PluginInstallationState.DEGRADED:
      return 'degraded';
    case PluginInstallationState.DISABLED:
    case PluginInstallationState.UNINSTALLED:
      return 'disabled';
  }
}

function runtimeEffect(value: PrismaPluginEffect): PluginEffect {
  switch (value) {
    case PrismaPluginEffect.READ:
      return 'read';
    case PrismaPluginEffect.WRITE:
      return 'write';
    case PrismaPluginEffect.DESTRUCTIVE:
      return 'destructive';
  }
}

function prismaEffect(value: PluginEffect): PrismaPluginEffect {
  switch (value) {
    case 'read':
      return PrismaPluginEffect.READ;
    case 'write':
      return PrismaPluginEffect.WRITE;
    case 'destructive':
      return PrismaPluginEffect.DESTRUCTIVE;
  }
}

function prismaInvocationState(value: PluginInvocationLedgerEvent['state']): PluginInvocationState {
  switch (value) {
    case 'running':
      return PluginInvocationState.RUNNING;
    case 'succeeded':
      return PluginInvocationState.SUCCEEDED;
    case 'failed':
      return PluginInvocationState.FAILED;
    case 'cancelled':
      return PluginInvocationState.CANCELLED;
  }
}

function authorityState(
  state: AuthorityGrantState,
  validFrom: Date,
  validUntil: Date,
): PluginCallAuthorizationSnapshot['authority']['state'] {
  const now = Date.now();
  if (
    state === AuthorityGrantState.ACTIVE &&
    validFrom.getTime() <= now &&
    validUntil.getTime() > now
  ) {
    return 'active';
  }
  if (state === AuthorityGrantState.REVOKED) return 'revoked';
  if (state === AuthorityGrantState.EXHAUSTED) return 'exhausted';
  return 'expired';
}

function departmentsCompatible(runDepartmentId: string | null, candidate: string | null): boolean {
  return candidate === null || candidate === runDepartmentId;
}

function normalizedLatency(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new PluginRuntimeError('PLUGIN_INVOCATION_LEDGER_INVALID', false);
  }
  return Math.min(2_147_483_647, Math.round(value));
}

function inputAtPath(input: JsonValue, pathInput: unknown): JsonValue {
  const path = pluginCallInputPathSchema.parse(pathInput);
  let current = input;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INPUT_MISSING', false);
      }
      const next: JsonValue | undefined = current[segment];
      if (next === undefined) {
        throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INPUT_MISSING', false);
      }
      current = next;
      continue;
    }
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INPUT_MISSING', false);
    }
    const next: JsonValue | undefined = current[segment];
    if (next === undefined) {
      throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INPUT_MISSING', false);
    }
    current = next;
  }
  return current;
}

/**
 * PostgreSQL-backed authorization and append-only evidence boundary for Plugin calls.
 * It intentionally does not dispatch tools or connect Plugins to the model execution loop.
 */
export class PrismaWorkerPluginExecutionStore
  implements WorkerPluginExecutionStore, WorkerPluginPlanSource
{
  constructor(private readonly prisma: PrismaClient) {}

  async loadPlannedCalls(
    claimed: ClaimedRun,
    workerId: string,
  ): Promise<readonly PlannedWorkerPluginCall[]> {
    const run = await this.prisma.executionRun.findUnique({
      where: { id: claimed.id },
      select: {
        id: true,
        releaseId: true,
        releaseDigest: true,
        entryResourceVersionId: true,
        legacyEntrypointUnresolved: true,
        contextDigest: true,
        input: true,
        state: true,
        leaseOwner: true,
        pluginCallPlans: {
          orderBy: { ordinal: 'asc' },
          select: {
            id: true,
            runId: true,
            requirementId: true,
            ordinal: true,
            invocationKey: true,
            inputPath: true,
            outputContextKey: true,
            requirement: {
              select: {
                id: true,
                runId: true,
                installationId: true,
                pluginVersionId: true,
                pluginDigest: true,
                capabilityName: true,
                effect: true,
                contextDigest: true,
              },
            },
          },
        },
      },
    });
    if (run === null) throw new PluginRuntimeError('PLUGIN_RUN_NOT_FOUND', false);
    if (run.legacyEntrypointUnresolved || run.entryResourceVersionId === null) {
      throw new PluginRuntimeError('PLUGIN_ENTRYPOINT_UNRESOLVED', false);
    }
    const entryResourceVersionId = run.entryResourceVersionId;
    if (
      run.state !== ExecutionRunState.RUNNING ||
      run.leaseOwner !== workerId ||
      run.id !== claimed.id ||
      run.releaseId !== claimed.releaseId ||
      run.releaseDigest !== claimed.releaseDigest ||
      entryResourceVersionId !== claimed.entryResourceVersionId ||
      run.contextDigest !== claimed.contextDigest
    ) {
      throw new PluginRuntimeError('PLUGIN_RUN_LEASE_LOST', false);
    }
    const input = asJsonValue(run.input);
    return run.pluginCallPlans.map((plan) => {
      const requirement = plan.requirement;
      if (
        plan.runId !== run.id ||
        plan.requirementId !== requirement.id ||
        requirement.runId !== run.id ||
        plan.invocationKey !== `${run.id}:plugin:${plan.ordinal}` ||
        requirement.contextDigest !== run.contextDigest
      ) {
        throw new PluginRuntimeError('PLUGIN_CALL_PLAN_MISMATCH', false);
      }
      return {
        ordinal: plan.ordinal,
        outputContextKey: plan.outputContextKey,
        call: {
          invocationKey: plan.invocationKey,
          planId: plan.id,
          requirementId: requirement.id,
          runId: run.id,
          workerId,
          releaseId: run.releaseId,
          releaseDigest: run.releaseDigest,
          entryResourceVersionId,
          contextDigest: run.contextDigest,
          installationId: requirement.installationId,
          pluginVersionId: requirement.pluginVersionId,
          pluginDigest: requirement.pluginDigest,
          tool: requirement.capabilityName,
          effect: runtimeEffect(requirement.effect),
          input: inputAtPath(input, plan.inputPath),
        },
      };
    });
  }

  async revalidate(call: WorkerPluginCall): Promise<PluginCallAuthorizationSnapshot> {
    const [run, installation] = await Promise.all([
      this.prisma.executionRun.findUnique({
        where: { id: call.runId },
        select: {
          id: true,
          workspaceId: true,
          departmentId: true,
          releaseId: true,
          entryResourceVersionId: true,
          legacyEntrypointUnresolved: true,
          releaseDigest: true,
          contextDigest: true,
          input: true,
          cancelRequestedAt: true,
          leaseOwner: true,
          developmentDraft: true,
          requiresPluginApproval: true,
          state: true,
          requiredPluginScopes: true,
          release: {
            select: { id: true, workspaceId: true, departmentId: true, digest: true },
          },
          authorityGrant: {
            select: {
              workspaceId: true,
              departmentId: true,
              releaseId: true,
              entryResourceVersionId: true,
              releaseDigest: true,
              contextDigest: true,
              state: true,
              validFrom: true,
              validUntil: true,
              pluginScopes: true,
            },
          },
          approvalRequest: {
            select: {
              state: true,
              decidedBy: true,
              rationale: true,
              decidedAt: true,
            },
          },
          pluginRequirements: {
            where: {
              id: call.requirementId,
              installationId: call.installationId,
              pluginVersionId: call.pluginVersionId,
              capabilityName: call.tool,
            },
            select: {
              id: true,
              runId: true,
              installationId: true,
              pluginVersionId: true,
              pluginDigest: true,
              capabilityName: true,
              effect: true,
              approvalRequired: true,
              authorityScope: true,
              contextDigest: true,
            },
          },
          pluginCallPlans: {
            where: { id: call.planId },
            select: {
              id: true,
              runId: true,
              requirementId: true,
              invocationKey: true,
              inputPath: true,
            },
          },
        },
      }),
      this.prisma.pluginInstallation.findUnique({
        where: { id: call.installationId },
        select: {
          id: true,
          workspaceId: true,
          departmentId: true,
          pluginVersionId: true,
          pluginDigest: true,
          transport: true,
          residency: true,
          state: true,
          developmentOnly: true,
          secretBindings: { select: { slot: true, secretRef: true } },
          pluginVersion: {
            select: {
              id: true,
              version: true,
              digest: true,
              definition: true,
              family: { select: { kind: true } },
            },
          },
        },
      }),
    ]);
    if (run === null) throw new PluginRuntimeError('PLUGIN_RUN_NOT_FOUND', false);
    if (run.legacyEntrypointUnresolved || run.entryResourceVersionId === null) {
      throw new PluginRuntimeError('PLUGIN_ENTRYPOINT_UNRESOLVED', false);
    }
    if (installation === null) {
      throw new PluginRuntimeError('PLUGIN_INSTALLATION_NOT_FOUND', false);
    }
    if (run.state !== ExecutionRunState.RUNNING) {
      throw new PluginRuntimeError('PLUGIN_RUN_NOT_EXECUTING', false);
    }
    const grant = run.authorityGrant;
    if (grant === null) throw new PluginRuntimeError('PLUGIN_AUTHORITY_INACTIVE', false);
    if (
      run.workspaceId !== run.release.workspaceId ||
      run.workspaceId !== grant.workspaceId ||
      run.workspaceId !== installation.workspaceId ||
      !departmentsCompatible(run.departmentId, run.release.departmentId) ||
      !departmentsCompatible(run.departmentId, grant.departmentId) ||
      !departmentsCompatible(run.departmentId, installation.departmentId)
    ) {
      throw new PluginRuntimeError('PLUGIN_WORKSPACE_SCOPE_MISMATCH', false);
    }

    const requirements = run.pluginRequirements;
    if (requirements.length !== 1) {
      throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SNAPSHOT_MISMATCH', false);
    }
    const requirement = requirements[0]!;
    const plans = run.pluginCallPlans;
    if (plans.length !== 1) {
      throw new PluginRuntimeError('PLUGIN_CALL_PLAN_MISMATCH', false);
    }
    const plan = plans[0]!;
    const plannedInput = inputAtPath(asJsonValue(run.input), plan.inputPath);
    if (pluginPayloadDigest(plannedInput) !== pluginPayloadDigest(call.input)) {
      throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INPUT_MISMATCH', false);
    }
    const perRunApproval = run.approvalRequest;
    const pluginApprovalSatisfied =
      !run.requiresPluginApproval ||
      (perRunApproval?.state === ApprovalRequestState.APPROVED &&
        perRunApproval.decidedBy !== null &&
        !perRunApproval.decidedBy.startsWith('system:') &&
        perRunApproval.rationale !== null &&
        perRunApproval.rationale.trim().length >= 10 &&
        perRunApproval.decidedAt !== null);
    const persistedRequirementScope = pluginAuthorityScopeSchema.parse(requirement.authorityScope);
    const requiredScopes = z
      .array(runPluginRequirementSchema)
      .max(100)
      .parse(run.requiredPluginScopes);
    const matchingRequiredScopes = requiredScopes.filter(
      (scope) =>
        scope.installationId === call.installationId &&
        scope.pluginVersionId === call.pluginVersionId &&
        scope.tool === call.tool,
    );
    if (matchingRequiredScopes.length !== 1) {
      throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SNAPSHOT_MISMATCH', false);
    }
    const runRequirement = matchingRequiredScopes[0]!;
    const { executionPlacement, approvalRequired, ...requiredAuthorityScope } = runRequirement;
    if (
      executionPlacement !== runtimePlacement(installation.residency) ||
      approvalRequired !== requirement.approvalRequired ||
      !sameJson(requiredAuthorityScope, persistedRequirementScope)
    ) {
      throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SNAPSHOT_MISMATCH', false);
    }

    const manifest = resourceManifestSchema.parse(installation.pluginVersion.definition);
    if (
      manifest.kind !== 'Plugin' ||
      installation.pluginVersion.family.kind !== ResourceKind.PLUGIN ||
      manifest.metadata.version !== installation.pluginVersion.version
    ) {
      throw new PluginRuntimeError('PLUGIN_DEFINITION_INVALID', false);
    }
    const definition = pluginRuntimeDefinitionFromSpec(
      {
        pluginVersionId: installation.pluginVersion.id,
        pluginVersion: installation.pluginVersion.version,
        pluginDigest: installation.pluginVersion.digest,
      },
      pluginResourceSpecSchema.parse(manifest.spec),
    );
    const authorityScopes = z
      .array(pluginAuthorityScopeSchema)
      .max(100)
      .parse(grant.pluginScopes) as PluginAuthorityScopeRuntime[];
    const reachability = await this.reachability(
      run.releaseId,
      run.entryResourceVersionId,
      installation.pluginVersionId,
      installation.pluginDigest,
    );
    const installationRuntime: PluginInstallationRuntime = {
      id: installation.id,
      pluginVersionId: installation.pluginVersionId,
      pluginDigest: installation.pluginDigest,
      transport: runtimeTransport(installation.transport),
      placement: runtimePlacement(installation.residency),
      state: runtimeInstallationState(installation.state),
      developmentOnly: installation.developmentOnly,
      secretBindings: Object.fromEntries(
        installation.secretBindings.map(({ slot, secretRef }) => [slot, secretRef]),
      ),
    };

    return {
      run: {
        id: run.id,
        releaseId: run.releaseId,
        releaseDigest: run.releaseDigest,
        entryResourceVersionId: run.entryResourceVersionId,
        contextDigest: run.contextDigest,
        cancellationRequested: run.cancelRequestedAt !== null,
        developmentDraft: run.developmentDraft,
        pluginApprovalSatisfied,
        leaseOwner: run.leaseOwner,
      },
      release: { id: run.release.id, digest: run.release.digest },
      entrypoint: {
        resourceVersionId: run.entryResourceVersionId,
        belongsToRelease: reachability.belongsToRelease,
        pluginReachableThroughDependencies: reachability.pluginReachable,
      },
      installation: installationRuntime,
      requirement: {
        id: requirement.id,
        runId: requirement.runId,
        installationId: requirement.installationId,
        pluginVersionId: requirement.pluginVersionId,
        pluginDigest: requirement.pluginDigest,
        capabilityName: requirement.capabilityName,
        effect: runtimeEffect(requirement.effect),
        contextDigest: requirement.contextDigest,
        executionPlacement,
        approvalRequired: requirement.approvalRequired,
        authorityScope: persistedRequirementScope,
        state: 'active',
      },
      plan: {
        id: plan.id,
        runId: plan.runId,
        requirementId: plan.requirementId,
        invocationKey: plan.invocationKey,
      },
      authority: {
        state: authorityState(grant.state, grant.validFrom, grant.validUntil),
        releaseId: grant.releaseId,
        releaseDigest: grant.releaseDigest,
        entryResourceVersionId: grant.entryResourceVersionId,
        contextDigest: grant.contextDigest,
        scopes: authorityScopes,
      },
      definition,
    };
  }

  async appendInvocation(event: PluginInvocationLedgerEvent): Promise<'inserted' | 'existing'> {
    if (
      (event.sequence === 1 && event.state !== 'running') ||
      (event.sequence === 2 && event.state === 'running')
    ) {
      throw new PluginRuntimeError('PLUGIN_INVOCATION_LEDGER_INVALID', false);
    }
    const latencyMs = normalizedLatency(event.latencyMs);
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${event.invocationKey}:plugin-invocation`}))`;
        const existing = await transaction.pluginInvocation.findFirst({
          where: { invocationKey: event.invocationKey, sequence: event.sequence },
        });
        if (existing !== null) {
          const identical =
            existing.planId === event.planId &&
            !existing.legacyPlanUnresolved &&
            existing.runId === event.runId &&
            existing.installationId === event.installationId &&
            existing.toolName === event.toolName &&
            runtimeEffect(existing.effect) === event.effect &&
            existing.state === prismaInvocationState(event.state) &&
            existing.requestDigest === event.inputDigest &&
            existing.responseDigest === event.outputDigest &&
            existing.errorCode === event.errorCode &&
            existing.latencyMs === latencyMs &&
            (existing.costUsd === null ? null : Number(existing.costUsd)) === event.costUsd;
          if (!identical) {
            throw new PluginRuntimeError('PLUGIN_INVOCATION_LEDGER_DIVERGED', false);
          }
          return 'existing';
        }

        const [run, installation] = await Promise.all([
          transaction.executionRun.findUnique({
            where: { id: event.runId },
            select: {
              workspaceId: true,
              departmentId: true,
              state: true,
              cancelRequestedAt: true,
              leaseOwner: true,
              authorityGrant: { select: { state: true, pluginScopes: true } },
            },
          }),
          transaction.pluginInstallation.findUnique({
            where: { id: event.installationId },
            select: {
              workspaceId: true,
              departmentId: true,
              pluginVersionId: true,
              pluginDigest: true,
              state: true,
            },
          }),
        ]);
        if (run === null || installation === null) {
          throw new PluginRuntimeError('PLUGIN_INVOCATION_LEDGER_INVALID', false);
        }
        if (
          run.workspaceId !== installation.workspaceId ||
          !departmentsCompatible(run.departmentId, installation.departmentId)
        ) {
          throw new PluginRuntimeError('PLUGIN_WORKSPACE_SCOPE_MISMATCH', false);
        }

        if (event.sequence === 1) {
          if (
            run.state !== ExecutionRunState.RUNNING ||
            run.leaseOwner !== event.workerId ||
            installation.state !== PluginInstallationState.ENABLED
          ) {
            throw new PluginRuntimeError('PLUGIN_DISABLED', false);
          }
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${event.runId}:${event.installationId}:${event.toolName}:plugin-limit`}))`;
          const requirement = await transaction.runPluginRequirement.findFirst({
            where: {
              callPlans: { some: { id: event.planId, invocationKey: event.invocationKey } },
              runId: event.runId,
              installationId: event.installationId,
              pluginVersionId: installation.pluginVersionId,
              capabilityName: event.toolName,
            },
            select: { authorityScope: true },
          });
          if (requirement === null) {
            throw new PluginRuntimeError('PLUGIN_REQUIREMENT_SNAPSHOT_MISMATCH', false);
          }
          if (
            run.authorityGrant === null ||
            run.authorityGrant.state !== AuthorityGrantState.ACTIVE
          ) {
            throw new PluginRuntimeError('PLUGIN_AUTHORITY_INACTIVE', false);
          }
          const invocationScopes = z
            .array(pluginAuthorityScopeSchema)
            .max(100)
            .parse(run.authorityGrant.pluginScopes)
            .filter(
              (scope) =>
                scope.installationId === event.installationId &&
                scope.pluginVersionId === installation.pluginVersionId &&
                scope.tool === event.toolName,
            );
          if (invocationScopes.length !== 1) {
            throw new PluginRuntimeError('PLUGIN_AUTHORITY_SCOPE_MISMATCH', false);
          }
          const invocationScope = invocationScopes[0]!;
          const priorInvocations = await transaction.pluginInvocation.count({
            where: {
              runId: event.runId,
              installationId: event.installationId,
              toolName: event.toolName,
              sequence: 1,
            },
          });
          if (priorInvocations >= invocationScope.limits.maxInvocationsPerRun) {
            throw new PluginRuntimeError('PLUGIN_INVOCATION_LIMIT_EXCEEDED', false);
          }
        } else {
          const beginning = await transaction.pluginInvocation.findFirst({
            where: { invocationKey: event.invocationKey, sequence: 1 },
          });
          if (
            beginning === null ||
            beginning.planId !== event.planId ||
            beginning.legacyPlanUnresolved ||
            beginning.runId !== event.runId ||
            beginning.installationId !== event.installationId ||
            beginning.toolName !== event.toolName ||
            beginning.requestDigest !== event.inputDigest
          ) {
            throw new PluginRuntimeError('PLUGIN_INVOCATION_LEDGER_INVALID', false);
          }
          if (
            event.state === 'succeeded' &&
            (run.state !== ExecutionRunState.RUNNING ||
              run.leaseOwner !== event.workerId ||
              run.cancelRequestedAt !== null ||
              installation.state !== PluginInstallationState.ENABLED ||
              run.authorityGrant?.state !== AuthorityGrantState.ACTIVE)
          ) {
            throw new PluginRuntimeError(
              run.cancelRequestedAt !== null ? 'RUN_CANCELLED' : 'PLUGIN_DISABLED',
              false,
            );
          }
        }

        await transaction.pluginInvocation.create({
          data: {
            workspaceId: run.workspaceId,
            departmentId: run.departmentId,
            invocationKey: event.invocationKey,
            planId: event.planId,
            legacyPlanUnresolved: false,
            sequence: event.sequence,
            runId: event.runId,
            installationId: event.installationId,
            pluginVersionId: installation.pluginVersionId,
            pluginDigest: installation.pluginDigest,
            toolName: event.toolName,
            effect: prismaEffect(event.effect),
            state: prismaInvocationState(event.state),
            requestDigest: event.inputDigest,
            responseDigest: event.outputDigest,
            errorCode: event.errorCode,
            summary: null,
            latencyMs,
            costUsd: event.costUsd,
            startedAt: event.sequence === 1 ? new Date() : null,
            finishedAt: event.sequence === 2 ? new Date() : null,
          },
        });
        return 'inserted';
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async reachability(
    releaseId: string,
    entryResourceVersionId: string,
    pluginVersionId: string,
    pluginDigest: string,
  ): Promise<ReachabilityRow> {
    const rows = await this.prisma.$queryRaw<ReachabilityRow[]>`
      WITH RECURSIVE dependency_closure("resourceVersionId", digest, path, depth) AS (
        SELECT rr."resourceVersionId", rr.digest, ARRAY[rr."resourceVersionId"]::uuid[], 0
        FROM "ReleaseResource" rr
        JOIN "ResourceVersion" rv
          ON rv.id = rr."resourceVersionId" AND rv.digest = rr.digest
        WHERE rr."releaseId" = ${releaseId}::uuid
          AND rr."resourceVersionId" = ${entryResourceVersionId}::uuid
        UNION ALL
        SELECT pin."targetVersionId", pin."targetDigest",
               closure.path || pin."targetVersionId", closure.depth + 1
        FROM dependency_closure closure
        JOIN "ResourceDependencyPin" pin
          ON pin."sourceVersionId" = closure."resourceVersionId"
        JOIN "ResourceVersion" target
          ON target.id = pin."targetVersionId" AND target.digest = pin."targetDigest"
        JOIN "ReleaseResource" rr
          ON rr."releaseId" = ${releaseId}::uuid
         AND rr."resourceVersionId" = pin."targetVersionId"
         AND rr.digest = pin."targetDigest"
        WHERE closure.depth < 100
          AND NOT pin."targetVersionId" = ANY(closure.path)
      )
      SELECT
        EXISTS(SELECT 1 FROM dependency_closure WHERE "resourceVersionId" = ${entryResourceVersionId}::uuid)
          AS "belongsToRelease",
        EXISTS(
          SELECT 1 FROM dependency_closure
          WHERE "resourceVersionId" = ${pluginVersionId}::uuid AND digest = ${pluginDigest}
        ) AS "pluginReachable"
    `;
    const result = rows[0];
    return result ?? { belongsToRelease: false, pluginReachable: false };
  }
}
