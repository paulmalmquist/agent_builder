import {
  ExecutionRunState,
  PluginHealthStatus,
  PluginInstallationState,
  PluginResidency,
  PluginTransport,
  Prisma,
  ResourceKind,
  ResourceLifecycle,
  type PluginInstallation as DatabasePluginInstallation,
  type PrismaClient,
} from '@prisma/client';
import {
  configurePluginInstallationRequestSchema,
  installPluginRequestSchema,
  pluginCatalogItemSchema,
  pluginCatalogResponseSchema,
  pluginHealthCheckSchema,
  pluginInstallationListResponseSchema,
  pluginInstallationSchema,
  pluginAuthorityScopeSchema,
  pluginResourceSpecSchema,
  pluginStateChangeRequestSchema,
  pluginUsedByResponseSchema,
  resourceManifestSchema,
  uninstallPluginRequestSchema,
  type PluginInstallation,
  type PluginResourceSpec,
  type pluginCatalogQuerySchema,
} from '@agent-builder/contracts';
import {
  canonicalJson,
  pluginRuntimeDefinitionFromSpec,
  sha256,
  type PluginHealthProbe,
  type PluginInstallationRuntime,
} from '@paul-os/runtime';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson } from '../json-boundary.js';
import { currentActorId, currentRequestContext } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';
import { appendExecutionRunEvent } from './attention-service.js';

const installationStateWire = {
  [PluginInstallationState.INSTALLED]: 'installed',
  [PluginInstallationState.ENABLED]: 'enabled',
  [PluginInstallationState.DISABLED]: 'disabled',
  [PluginInstallationState.DEGRADED]: 'degraded',
  [PluginInstallationState.UNINSTALLED]: null,
} as const;
const transportMap = {
  mcp: PluginTransport.MCP,
  http: PluginTransport.HTTP,
  cli: PluginTransport.CLI,
  db: PluginTransport.DB,
} as const;
const transportWire = {
  [PluginTransport.MCP]: 'mcp',
  [PluginTransport.HTTP]: 'http',
  [PluginTransport.CLI]: 'cli',
  [PluginTransport.DB]: 'db',
} as const;
const placementMap = {
  control_plane: PluginResidency.CONTROL_PLANE,
  workstation: PluginResidency.WORKSTATION,
} as const;
const placementWire = {
  [PluginResidency.CONTROL_PLANE]: 'control_plane',
  [PluginResidency.WORKSTATION]: 'workstation',
} as const;
const healthWire = {
  [PluginHealthStatus.HEALTHY]: 'healthy',
  [PluginHealthStatus.DEGRADED]: 'degraded',
  [PluginHealthStatus.UNAVAILABLE]: 'unavailable',
} as const;
const healthMap = {
  healthy: PluginHealthStatus.HEALTHY,
  degraded: PluginHealthStatus.DEGRADED,
  unavailable: PluginHealthStatus.UNAVAILABLE,
} as const;

type PluginVersionRecord = Prisma.ResourceVersionGetPayload<{ include: { family: true } }>;
type InstallationRecord = Prisma.PluginInstallationGetPayload<{
  include: {
    secretBindings: true;
    pluginVersion: { include: { family: true } };
    healthChecks: true;
  };
}>;

function pluginSpec(record: PluginVersionRecord): PluginResourceSpec {
  if (record.family.kind !== ResourceKind.PLUGIN) {
    throw new AppError(422, 'RESOURCE_NOT_PLUGIN', 'The resource version is not a Plugin');
  }
  const manifest = parseJson(
    resourceManifestSchema,
    record.definition,
    'ResourceVersion.definition',
  );
  if (manifest.kind !== 'Plugin') {
    throw new AppError(409, 'PLUGIN_DEFINITION_INVALID', 'The Plugin definition kind is invalid');
  }
  return pluginResourceSpecSchema.parse(manifest.spec);
}

function requiredSecretSlots(spec: PluginResourceSpec): string[] {
  return spec.secretSlots.filter(({ required }) => required).map(({ name }) => name);
}

function configuredSlots(record: Pick<InstallationRecord, 'secretBindings'>): Set<string> {
  return new Set(record.secretBindings.map(({ slot }) => slot));
}

function toInstallation(record: InstallationRecord): PluginInstallation {
  const state = installationStateWire[record.state];
  if (state === null) {
    throw new AppError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation was not found');
  }
  const spec = pluginSpec(record.pluginVersion);
  const configured = configuredSlots(record);
  return pluginInstallationSchema.parse({
    id: record.id,
    pluginVersionId: record.pluginVersionId,
    pluginDigest: record.pluginDigest,
    state,
    executionPlacement: placementWire[record.residency],
    developmentOnly: record.developmentOnly,
    secretBindings: spec.secretSlots.map(({ name }) => ({
      slot: name,
      configured: configured.has(name),
    })),
    installedBy: record.installedBy,
    installedAt: record.installedAt.toISOString(),
    configuredAt: record.configuredAt?.toISOString() ?? null,
    disabledAt: record.disabledAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  });
}

function safeHealthMessage(status: 'healthy' | 'degraded' | 'unavailable'): string {
  if (status === 'healthy') return 'The Plugin health check passed.';
  if (status === 'degraded') return 'The Plugin health check reported degraded availability.';
  return 'The Plugin health check is unavailable.';
}

function activeInstallationWhere(): Prisma.PluginInstallationWhereInput {
  return { state: { not: PluginInstallationState.UNINSTALLED } };
}

export function effectivePluginHealthIntervalMs(declaredIntervalSeconds: number): number {
  return Math.min(declaredIntervalSeconds * 1_000, 60_000);
}

export function pluginClassificationAllowed(
  classification: PluginResourceSpec['classification'],
  providerPolicy: AppConfig['model']['providerPolicy'],
): boolean {
  return classification !== 'restricted' || providerPolicy === 'gateway_only';
}

export class PluginService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, 'environment'> & {
      model?: Pick<AppConfig['model'], 'providerPolicy'>;
    },
    private readonly healthProbe: PluginHealthProbe,
  ) {}

  private classificationAllowed(classification: PluginResourceSpec['classification']): boolean {
    // Restricted connectors are never exposed to a direct-provider deployment. They become
    // available only after the platform has been configured to fail closed through the approved
    // gateway boundary. Tests that pass the historical minimal config retain direct mode.
    return pluginClassificationAllowed(
      classification,
      this.config.model?.providerPolicy ?? 'direct_allowed',
    );
  }

  private async appendScopedPlatformEvent(
    transaction: Prisma.TransactionClient,
    scope: { workspaceId: string; departmentId: string | null },
    input: { kind: string; entityType: string; entityId: string; summary: Prisma.InputJsonObject },
  ): Promise<void> {
    const context = currentRequestContext();
    const streamKey = `${scope.workspaceId}:${scope.departmentId ?? 'workspace'}:platform-events`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${streamKey}))`;
    await transaction.platformEvent.create({
      data: {
        workspaceId: scope.workspaceId,
        departmentId: scope.departmentId,
        ...input,
        actorId: context.principal.actorId,
        requestId: context.principal.requestId,
      },
    });
  }

  private async holdAffectedRuns(
    transaction: Prisma.TransactionClient,
    installation: Pick<DatabasePluginInstallation, 'id' | 'workspaceId' | 'departmentId'>,
    reason: string,
  ): Promise<number> {
    const affected = await transaction.executionRun.findMany({
      where: {
        pluginRequirements: { some: { installationId: installation.id } },
        state: { in: [ExecutionRunState.QUEUED, ExecutionRunState.RUNNING] },
        workspaceId: installation.workspaceId,
        ...(installation.departmentId === null ? {} : { departmentId: installation.departmentId }),
      },
      orderBy: { id: 'asc' },
    });
    if (affected.length > 0) {
      await transaction.$queryRaw`
        SELECT "id" FROM "ExecutionRun"
        WHERE "id" IN (${Prisma.join(affected.map(({ id }) => Prisma.sql`${id}::uuid`))})
        ORDER BY "id" FOR UPDATE
      `;
    }
    const now = new Date();
    for (const run of affected) {
      if (run.state === ExecutionRunState.QUEUED) {
        await transaction.executionRun.update({
          where: { id: run.id },
          data: {
            state: ExecutionRunState.PAUSED_PLUGIN,
            message: reason,
            approvalReasons: ['A required Plugin is unavailable'],
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          },
        });
        await appendExecutionRunEvent(transaction, run, {
          phase: 'plugin',
          state: 'paused_plugin',
          message: 'The run paused because a required Plugin became unavailable.',
        });
        await this.appendScopedPlatformEvent(transaction, run, {
          kind: 'execution.paused_plugin',
          entityType: 'ExecutionRun',
          entityId: run.id,
          summary: { reason: 'required_plugin_unavailable' },
        });
      } else {
        await transaction.executionRun.update({
          where: { id: run.id },
          data: { cancelRequestedAt: now, message: 'Cancellation requested: Plugin unavailable' },
        });
        await appendExecutionRunEvent(transaction, run, {
          phase: 'plugin',
          state: 'cancellation_requested',
          message: 'Cancellation was requested because a required Plugin became unavailable.',
        });
        await this.appendScopedPlatformEvent(transaction, run, {
          kind: 'execution.plugin_cancellation_requested',
          entityType: 'ExecutionRun',
          entityId: run.id,
          summary: { reason: 'required_plugin_unavailable' },
        });
      }
    }
    return affected.length;
  }

  private async version(pluginVersionId: string): Promise<PluginVersionRecord> {
    const record = await this.prisma.resourceVersion.findFirst({
      where: {
        id: pluginVersionId,
        family: { kind: ResourceKind.PLUGIN, ...aggregateScopeWhere() },
      },
      include: { family: true },
    });
    if (record === null) {
      throw new AppError(404, 'PLUGIN_NOT_FOUND', 'Plugin was not found');
    }
    pluginSpec(record);
    return record;
  }

  private async installation(
    installationId: string,
    transaction: Prisma.TransactionClient | PrismaClient = this.prisma,
  ): Promise<InstallationRecord> {
    const record = await transaction.pluginInstallation.findFirst({
      where: { id: installationId, ...activeInstallationWhere(), ...aggregateScopeWhere() },
      include: {
        secretBindings: { orderBy: { slot: 'asc' } },
        pluginVersion: { include: { family: true } },
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
      },
    });
    if (record === null) {
      throw new AppError(404, 'PLUGIN_INSTALLATION_NOT_FOUND', 'Plugin installation was not found');
    }
    return record;
  }

  async listCatalog(
    query: z.output<typeof pluginCatalogQuerySchema>,
  ): Promise<z.infer<typeof pluginCatalogResponseSchema>> {
    const weekStartedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [versions, grants, invocationCosts] = await Promise.all([
      this.prisma.resourceVersion.findMany({
        where: {
          family: { kind: ResourceKind.PLUGIN, ...aggregateScopeWhere() },
        },
        include: {
          family: true,
          pluginInstallations: {
            where: { ...activeInstallationWhere(), ...aggregateScopeWhere() },
            include: {
              healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
              invocations: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
            orderBy: { installedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(500, query.limit * 10),
      }),
      this.prisma.authorityGrant.findMany({
        where: {
          state: 'ACTIVE',
          validUntil: { gt: new Date() },
          ...aggregateScopeWhere(),
        },
        select: { pluginScopes: true },
      }),
      this.prisma.pluginInvocation.findMany({
        where: { createdAt: { gte: weekStartedAt }, ...aggregateScopeWhere() },
        select: { installationId: true, costUsd: true },
      }),
    ]);
    const activeDescriptions = new Map<string, Set<string>>();
    for (const grant of grants) {
      const scopes = parseJson(
        z.array(pluginAuthorityScopeSchema),
        grant.pluginScopes,
        'AuthorityGrant.pluginScopes',
      );
      for (const scope of scopes) {
        const current = activeDescriptions.get(scope.installationId) ?? new Set<string>();
        current.add(scope.scopeDescription);
        activeDescriptions.set(scope.installationId, current);
      }
    }
    const weeklyCosts = new Map<string, number>();
    for (const invocation of invocationCosts) {
      weeklyCosts.set(
        invocation.installationId,
        (weeklyCosts.get(invocation.installationId) ?? 0) + Number(invocation.costUsd ?? 0),
      );
    }
    const items = versions.flatMap((version) => {
      const spec = pluginSpec(version);
      if (!this.classificationAllowed(spec.classification)) return [];
      const installation = version.pluginInstallations[0] ?? null;
      const installationState =
        installation === null ? null : installationStateWire[installation.state];
      const latestHealth = installation?.healthChecks[0];
      const healthStatus = latestHealth === undefined ? 'unknown' : healthWire[latestHealth.status];
      if (query.transport !== undefined && spec.transport !== query.transport) return [];
      if (
        query.executionPlacement !== undefined &&
        spec.executionPlacement !== query.executionPlacement
      )
        return [];
      if (query.classification !== undefined && spec.classification !== query.classification)
        return [];
      if (!query.includeDisabled && installationState === 'disabled') return [];
      return [
        pluginCatalogItemSchema.parse({
          pluginVersionId: version.id,
          familyId: version.familyId,
          slug: version.family.slug,
          name: version.family.name,
          version: version.version,
          digest: version.digest,
          transport: spec.transport,
          executionPlacement: spec.executionPlacement,
          classification: spec.classification,
          capabilities: spec.capabilities.map((capability) => ({
            tool: capability.tool,
            description: capability.description,
            effect: capability.effect,
            approval: capability.approval,
            scopeDescription: capability.scopeDescription,
            limits: capability.limits,
          })),
          secretSlots: spec.secretSlots.map(({ name, description, required }) => ({
            name,
            description,
            required,
          })),
          installationId: installation?.id ?? null,
          installationState,
          healthStatus,
          lastUsedAt: installation?.invocations[0]?.createdAt.toISOString() ?? null,
          activeScopeDescriptions: [
            ...(installation === null ? [] : (activeDescriptions.get(installation.id) ?? [])),
          ],
          costThisWeekUsd: installation === null ? 0 : (weeklyCosts.get(installation.id) ?? 0),
        }),
      ];
    });
    return pluginCatalogResponseSchema.parse({ items: items.slice(0, query.limit) });
  }

  async getCatalogItem(pluginVersionId: string) {
    const result = await this.listCatalog({ includeDisabled: true, limit: 100 });
    const item = result.items.find((candidate) => candidate.pluginVersionId === pluginVersionId);
    if (item === undefined) throw new AppError(404, 'PLUGIN_NOT_FOUND', 'Plugin was not found');
    return item;
  }

  async listInstallations(query: {
    state?: 'installed' | 'enabled' | 'disabled' | 'degraded' | undefined;
    limit: number;
  }) {
    const state =
      query.state === undefined
        ? undefined
        : (Object.entries(installationStateWire).find(([, value]) => value === query.state)?.[0] as
            | PluginInstallationState
            | undefined);
    const records = await this.prisma.pluginInstallation.findMany({
      where: {
        ...aggregateScopeWhere(),
        ...activeInstallationWhere(),
        ...(state === undefined ? {} : { state }),
      },
      include: {
        secretBindings: { orderBy: { slot: 'asc' } },
        pluginVersion: { include: { family: true } },
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
      },
      orderBy: { installedAt: 'desc' },
      take: query.limit,
    });
    return pluginInstallationListResponseSchema.parse({ items: records.map(toInstallation) });
  }

  async getInstallation(installationId: string): Promise<PluginInstallation> {
    return toInstallation(await this.installation(installationId));
  }

  async install(input: z.input<typeof installPluginRequestSchema>) {
    const actor = requireHumanActor();
    const parsed = installPluginRequestSchema.parse(input);
    const version = await this.version(parsed.pluginVersionId);
    const spec = pluginSpec(version);
    if (!this.classificationAllowed(spec.classification)) {
      throw new AppError(
        403,
        'PLUGIN_CLASSIFICATION_FORBIDDEN',
        'Restricted Plugins require the approved gateway policy',
      );
    }
    if (parsed.developmentOnly && this.config.environment === 'production') {
      throw new AppError(
        422,
        'DEVELOPMENT_PLUGIN_FORBIDDEN',
        'Development-only Plugin installation is forbidden in production',
      );
    }
    if (
      !parsed.developmentOnly &&
      version.lifecycle !== ResourceLifecycle.CERTIFIED &&
      version.lifecycle !== ResourceLifecycle.PRODUCTION
    ) {
      throw new AppError(
        422,
        'PLUGIN_CERTIFICATION_REQUIRED',
        'A non-development Plugin installation requires a certified exact version',
      );
    }
    if (!parsed.developmentOnly && !/^[a-f0-9]{7,64}$/.test(version.sourceCommit)) {
      throw new AppError(
        422,
        'PLUGIN_PROVENANCE_UNVERIFIED',
        'A non-development Plugin installation requires verified source provenance',
      );
    }
    const requestedSlots = new Set<string>();
    const declaredSlots = new Set(spec.secretSlots.map(({ name }) => name));
    for (const binding of parsed.secretBindings) {
      if (!declaredSlots.has(binding.slot)) {
        throw new AppError(
          422,
          'PLUGIN_SECRET_SLOT_UNKNOWN',
          'A secret binding references an undeclared Plugin slot',
        );
      }
      if (requestedSlots.has(binding.slot)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Plugin secret slots must be unique');
      }
      requestedSlots.add(binding.slot);
    }
    const state = PluginInstallationState.INSTALLED;
    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.pluginInstallation.create({
          data: {
            ...aggregateScope(),
            pluginVersionId: version.id,
            pluginDigest: version.digest,
            transport: transportMap[spec.transport],
            residency: placementMap[spec.executionPlacement],
            state,
            developmentOnly: parsed.developmentOnly,
            configurationDigest:
              parsed.secretBindings.length === 0
                ? null
                : sha256(canonicalJson(parsed.secretBindings)),
            installedBy: actor,
            updatedBy: actor,
            configuredAt: parsed.secretBindings.length === 0 ? null : new Date(),
            secretBindings: {
              create: parsed.secretBindings.map(({ slot, reference }) => ({
                slot,
                secretRef: reference,
                createdBy: actor,
                updatedBy: actor,
              })),
            },
          },
          include: {
            secretBindings: { orderBy: { slot: 'asc' } },
            pluginVersion: { include: { family: true } },
            healthChecks: true,
          },
        });
        await appendAuditEvent(transaction, {
          action: 'plugin.installed',
          entityType: 'PluginInstallation',
          entityId: created.id,
          details: {
            pluginVersionId: version.id,
            pluginDigest: version.digest,
            developmentOnly: parsed.developmentOnly,
            configuredSlotCount: parsed.secretBindings.length,
          },
        });
        return created;
      });
      return toInstallation(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(
          409,
          'PLUGIN_ALREADY_INSTALLED',
          'This exact Plugin version is already installed in the current scope',
        );
      }
      throw error;
    }
  }

  async configure(
    installationId: string,
    input: z.input<typeof configurePluginInstallationRequestSchema>,
  ) {
    const actor = requireHumanActor();
    const parsed = configurePluginInstallationRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PluginInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
      const current = await this.installation(installationId, transaction);
      const spec = pluginSpec(current.pluginVersion);
      const declared = new Set(spec.secretSlots.map(({ name }) => name));
      const unique = new Set<string>();
      for (const binding of parsed.secretBindings) {
        if (!declared.has(binding.slot)) {
          throw new AppError(
            422,
            'PLUGIN_SECRET_SLOT_UNKNOWN',
            'A secret binding references an undeclared Plugin slot',
          );
        }
        if (unique.has(binding.slot)) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Plugin secret slots must be unique');
        }
        unique.add(binding.slot);
      }
      await transaction.pluginSecretBinding.deleteMany({ where: { installationId } });
      if (parsed.secretBindings.length > 0) {
        await transaction.pluginSecretBinding.createMany({
          data: parsed.secretBindings.map(({ slot, reference }) => ({
            installationId,
            slot,
            secretRef: reference,
            createdBy: actor,
            updatedBy: actor,
          })),
        });
      }
      const complete = requiredSecretSlots(spec).every((slot) => unique.has(slot));
      if (!complete) {
        throw new AppError(
          422,
          'PLUGIN_CONFIGURATION_INCOMPLETE',
          'Every required Plugin secret slot must remain configured',
        );
      }
      const affectedRunCount =
        current.state === PluginInstallationState.ENABLED ||
        current.state === PluginInstallationState.DEGRADED
          ? await this.holdAffectedRuns(
              transaction,
              current,
              'Paused because a required Plugin configuration changed',
            )
          : 0;
      await transaction.pluginInstallation.update({
        where: { id: installationId },
        data: {
          configurationDigest: sha256(canonicalJson(parsed.secretBindings)),
          configuredAt: new Date(),
          enableRequestedAt: null,
          enableRequestedBy: null,
          updatedBy: actor,
          ...(current.state === PluginInstallationState.DISABLED
            ? {}
            : {
                state: PluginInstallationState.INSTALLED,
                disabledAt: null,
                disabledBy: null,
                disabledReason: null,
              }),
        },
      });
      await appendAuditEvent(transaction, {
        action: 'plugin.configured',
        entityType: 'PluginInstallation',
        entityId: installationId,
        details: {
          configuredSlotCount: parsed.secretBindings.length,
          rationale: parsed.rationale,
          affectedRunCount,
        },
      });
      return this.installation(installationId, transaction);
    });
    return toInstallation(record);
  }

  async checkHealth(installationId: string) {
    const actor = currentActorId();
    const probedInstallation = await this.installation(installationId);
    const spec = pluginSpec(probedInstallation.pluginVersion);
    let result: { status: 'healthy' | 'degraded' | 'unavailable'; latencyMs: number };
    if (
      probedInstallation.state === PluginInstallationState.DISABLED ||
      spec.executionPlacement === 'workstation'
    ) {
      result = { status: 'unavailable', latencyMs: 0 };
    } else {
      const runtimeInstallation: PluginInstallationRuntime = {
        id: probedInstallation.id,
        pluginVersionId: probedInstallation.pluginVersionId,
        pluginDigest: probedInstallation.pluginDigest,
        transport: spec.transport,
        placement: spec.executionPlacement,
        state: installationStateWire[probedInstallation.state] ?? 'disabled',
        developmentOnly: probedInstallation.developmentOnly,
        secretBindings: Object.fromEntries(
          probedInstallation.secretBindings.map(({ slot, secretRef }) => [slot, secretRef]),
        ),
      };
      const startedAt = Date.now();
      try {
        const probed = await this.healthProbe.probe({
          definition: pluginRuntimeDefinitionFromSpec(
            {
              pluginVersionId: probedInstallation.pluginVersionId,
              pluginVersion: probedInstallation.pluginVersion.version,
              pluginDigest: probedInstallation.pluginDigest,
            },
            spec,
          ),
          installation: runtimeInstallation,
        });
        result = { status: probed.status, latencyMs: Math.max(0, Math.round(probed.latencyMs)) };
      } catch {
        // Probe failures are evidence, not response bodies. Never retain or log adapter errors.
        result = { status: 'unavailable', latencyMs: Math.max(0, Date.now() - startedAt) };
      }
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PluginInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
      const current = await this.installation(installationId, transaction);
      const configurationChangedDuringProbe =
        current.configurationDigest !== probedInstallation.configurationDigest ||
        current.configuredAt?.getTime() !== probedInstallation.configuredAt?.getTime();
      // A result obtained against a superseded configuration is never allowed to enable the
      // replacement configuration. Persist a sanitized unavailable result instead.
      const effectiveResult = configurationChangedDuringProbe
        ? { status: 'unavailable' as const, latencyMs: result.latencyMs }
        : result;
      const message = safeHealthMessage(effectiveResult.status);
      const created = await transaction.pluginHealthCheck.create({
        data: {
          installationId,
          status: healthMap[effectiveResult.status],
          probe: spec.transport,
          latencyMs: effectiveResult.latencyMs,
          summary: message,
          checkedBy: actor,
        },
      });
      if (current.state !== PluginInstallationState.DISABLED) {
        const enableRequested = current.enableRequestedAt !== null;
        await transaction.pluginInstallation.update({
          where: { id: installationId },
          data: {
            state: !enableRequested
              ? PluginInstallationState.INSTALLED
              : effectiveResult.status === 'healthy'
                ? PluginInstallationState.ENABLED
                : PluginInstallationState.DEGRADED,
            disabledAt: effectiveResult.status === 'healthy' ? null : current.disabledAt,
            disabledBy: effectiveResult.status === 'healthy' ? null : current.disabledBy,
            disabledReason: effectiveResult.status === 'healthy' ? null : current.disabledReason,
            updatedBy: actor,
          },
        });
        if (
          enableRequested &&
          effectiveResult.status !== 'healthy' &&
          (current.state === PluginInstallationState.ENABLED ||
            current.state === PluginInstallationState.DEGRADED)
        ) {
          await this.holdAffectedRuns(
            transaction,
            current,
            'Paused because a required Plugin health check failed',
          );
        }
      }
      if (effectiveResult.status !== 'healthy') {
        await this.appendScopedPlatformEvent(transaction, current, {
          kind: 'plugin.health.degraded',
          entityType: 'PluginInstallation',
          entityId: installationId,
          summary: { status: effectiveResult.status, transport: spec.transport },
        });
      }
      return created;
    });
    return pluginHealthCheckSchema.parse({
      id: record.id,
      installationId: record.installationId,
      status: healthWire[record.status],
      probeKind: transportWire[probedInstallation.transport],
      message: record.summary,
      latencyMs: record.latencyMs,
      checkedAt: record.checkedAt.toISOString(),
    });
  }

  async checkDueHealth(limit = 100): Promise<{ checked: number; failed: number }> {
    const now = Date.now();
    const installations = await this.prisma.pluginInstallation.findMany({
      where: {
        ...aggregateScopeWhere(),
        residency: PluginResidency.CONTROL_PLANE,
        state: {
          in: [
            PluginInstallationState.INSTALLED,
            PluginInstallationState.ENABLED,
            PluginInstallationState.DEGRADED,
          ],
        },
      },
      include: {
        pluginVersion: { include: { family: true } },
        healthChecks: { orderBy: { checkedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    const due = installations.filter((installation) => {
      // A declared slower cadence may reduce upstream load in a future policy, but a degraded
      // dependency must become visible within the product's 60-second operational objective.
      const intervalMs = effectivePluginHealthIntervalMs(
        pluginSpec(installation.pluginVersion).health.intervalSeconds,
      );
      return (installation.healthChecks[0]?.checkedAt.getTime() ?? 0) <= now - intervalMs;
    });
    let failed = 0;
    for (const installation of due) {
      try {
        await this.checkHealth(installation.id);
      } catch {
        failed += 1;
      }
    }
    return { checked: due.length, failed };
  }

  async enable(installationId: string, input: z.input<typeof pluginStateChangeRequestSchema>) {
    const actor = requireHumanActor();
    const parsed = pluginStateChangeRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PluginInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
      const current = await this.installation(installationId, transaction);
      const spec = pluginSpec(current.pluginVersion);
      if (current.residency !== PluginResidency.CONTROL_PLANE) {
        throw new AppError(
          409,
          'WORKSTATION_PLUGIN_UNAVAILABLE',
          'Workstation Plugins remain unavailable until the broker checkpoint',
        );
      }
      const configured = configuredSlots(current);
      if (!requiredSecretSlots(spec).every((slot) => configured.has(slot))) {
        throw new AppError(
          422,
          'PLUGIN_CONFIGURATION_INCOMPLETE',
          'Required Plugin secret bindings are not configured',
        );
      }
      const latestHealth = current.healthChecks[0];
      const freshnessMs = Math.max(60_000, spec.health.intervalSeconds * 2_000);
      const healthyAndFresh =
        latestHealth?.status !== PluginHealthStatus.HEALTHY ||
        (current.configuredAt !== null && latestHealth.checkedAt < current.configuredAt) ||
        latestHealth.checkedAt.getTime() < Date.now() - freshnessMs
          ? false
          : true;
      const updated = await transaction.pluginInstallation.update({
        where: { id: installationId },
        data: {
          state: healthyAndFresh
            ? PluginInstallationState.ENABLED
            : PluginInstallationState.INSTALLED,
          enableRequestedAt: new Date(),
          enableRequestedBy: actor,
          disabledAt: null,
          disabledBy: null,
          disabledReason: null,
          updatedBy: actor,
        },
      });
      await appendAuditEvent(transaction, {
        action: healthyAndFresh ? 'plugin.enabled' : 'plugin.enablement_started',
        entityType: 'PluginInstallation',
        entityId: installationId,
        details: { rationale: parsed.rationale, healthCheckRequired: !healthyAndFresh },
      });
      return this.installation(updated.id, transaction);
    });
    return toInstallation(record);
  }

  async disable(installationId: string, input: z.input<typeof pluginStateChangeRequestSchema>) {
    const actor = requireHumanActor();
    const parsed = pluginStateChangeRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PluginInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
      const current = await this.installation(installationId, transaction);
      const now = new Date();
      await transaction.pluginInstallation.update({
        where: { id: installationId },
        data: {
          state: PluginInstallationState.DISABLED,
          disabledAt: now,
          disabledBy: actor,
          disabledReason: parsed.rationale,
          enableRequestedAt: null,
          enableRequestedBy: null,
          updatedBy: actor,
        },
      });
      const affectedRunCount = await this.holdAffectedRuns(
        transaction,
        current,
        'Paused because a required Plugin is disabled',
      );
      await appendAuditEvent(transaction, {
        action: 'plugin.disabled',
        entityType: 'PluginInstallation',
        entityId: installationId,
        details: { rationale: parsed.rationale, affectedRunCount },
      });
      return this.installation(current.id, transaction);
    });
    return toInstallation(record);
  }

  async usedBy(installationId: string) {
    const installation = await this.installation(installationId);
    const pins = await this.prisma.resourceDependencyPin.findMany({
      where: { sourceVersion: { family: aggregateScopeWhere() } },
      select: { sourceVersionId: true, targetVersionId: true },
    });
    const dependentIds = new Set<string>();
    let frontier = new Set([installation.pluginVersionId]);
    while (frontier.size > 0) {
      const next = new Set<string>();
      for (const pin of pins) {
        if (frontier.has(pin.targetVersionId) && !dependentIds.has(pin.sourceVersionId)) {
          dependentIds.add(pin.sourceVersionId);
          next.add(pin.sourceVersionId);
        }
      }
      frontier = next;
    }
    const resources = await this.prisma.resourceVersion.findMany({
      where: { id: { in: [...dependentIds] }, family: aggregateScopeWhere() },
      include: { family: true },
    });
    const activeChannels = await this.prisma.productionChannel.findMany({
      where: { currentReleaseId: { not: null }, ...aggregateScopeWhere() },
      include: { currentRelease: { include: { resources: true } } },
    });
    const releaseItems = activeChannels.flatMap((channel) => {
      const release = channel.currentRelease;
      if (
        release === null ||
        !release.resources.some(
          ({ resourceVersionId }) =>
            resourceVersionId === installation.pluginVersionId ||
            dependentIds.has(resourceVersionId),
        )
      )
        return [];
      return [
        {
          kind: 'release' as const,
          id: release.id,
          name: channel.key,
          lifecycle: 'production',
          digest: release.digest,
        },
      ];
    });
    const resourceItems = resources.map((resource) => ({
      kind: 'resource' as const,
      id: resource.id,
      name: resource.family.name,
      lifecycle: resource.lifecycle.toLowerCase(),
      digest: resource.digest,
    }));
    const uninstallBlocked =
      releaseItems.length > 0 ||
      resources.some(
        ({ lifecycle }) =>
          lifecycle === ResourceLifecycle.CERTIFIED || lifecycle === ResourceLifecycle.PRODUCTION,
      );
    return pluginUsedByResponseSchema.parse({
      installationId,
      items: [...resourceItems, ...releaseItems],
      uninstallBlocked,
    });
  }

  async uninstall(installationId: string, input: z.input<typeof uninstallPluginRequestSchema>) {
    const actor = requireHumanActor();
    const parsed = uninstallPluginRequestSchema.parse(input);
    const dependencies = await this.usedBy(installationId);
    if (dependencies.uninstallBlocked) {
      throw new AppError(
        409,
        'PLUGIN_IN_USE',
        'Plugin cannot be uninstalled while certified resources or active releases depend on it',
      );
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "PluginInstallation" WHERE "id" = ${installationId}::uuid FOR UPDATE`;
      const current = await this.installation(installationId, transaction);
      const activeRuns = await transaction.runPluginRequirement.count({
        where: {
          installationId,
          run: { state: { in: [ExecutionRunState.QUEUED, ExecutionRunState.RUNNING] } },
        },
      });
      if (activeRuns > 0) {
        throw new AppError(409, 'PLUGIN_IN_USE', 'Plugin has active execution requirements');
      }
      await transaction.pluginSecretBinding.deleteMany({ where: { installationId } });
      await transaction.pluginInstallation.update({
        where: { id: installationId },
        data: {
          state: PluginInstallationState.UNINSTALLED,
          uninstalledAt: new Date(),
          uninstalledBy: actor,
          uninstallReason: parsed.rationale,
          enableRequestedAt: null,
          enableRequestedBy: null,
          updatedBy: actor,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'plugin.uninstalled',
        entityType: 'PluginInstallation',
        entityId: installationId,
        details: { pluginVersionId: current.pluginVersionId, rationale: parsed.rationale },
      });
    });
    return { installationId, uninstalled: true as const };
  }
}
