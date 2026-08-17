import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema, uuidSchema } from './schemas.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const semanticVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  .max(80);
const pluginIdentifierSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  .max(160);
const environmentVariableNameSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{1,127}$/)
  .describe('Environment-variable name only; values never belong in a manifest.');
const executableNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
  .describe('Executable name only. Paths, shells, and command fragments are forbidden.');
const commandArgumentSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[;&|`$<>\r\n]/u.test(value), 'Shell metacharacters are forbidden');
const headerNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,99}$/);

export const pluginTransportSchema = z.enum(['mcp', 'http', 'cli', 'db']);
export const pluginExecutionPlacementSchema = z.enum(['control_plane', 'workstation']);
export const pluginEffectSchema = z.enum(['read', 'write', 'destructive']);
export const pluginClassificationSchema = z.enum(['public', 'internal', 'restricted']);
export const pluginApprovalRequirementSchema = z.enum(['not_required', 'approval_required']);

export const exactPluginReferenceSchema = z
  .object({ familyId: uuidSchema, version: semanticVersionSchema })
  .strict();

export const pluginToolReferenceSchema = z
  .object({ plugin: exactPluginReferenceSchema, tool: pluginIdentifierSchema })
  .strict();

export const pluginToolRequirementSchema = z.union([
  pluginToolReferenceSchema,
  z
    .string()
    .trim()
    .min(1)
    .max(160)
    .describe('Deprecated legacy tool name. New definitions must use an exact Plugin/tool pin.'),
]);

export const pluginLimitSchema = z
  .object({
    timeoutMs: z.number().int().min(100).max(300_000),
    maxResponseBytes: z.number().int().min(1).max(50_000_000),
    maxRecords: z.number().int().min(1).max(1_000_000).optional(),
    maxInvocationsPerRun: z.number().int().min(1).max(10_000),
    maximumBytesBilled: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    maxEstimatedCostUsd: z.number().finite().nonnegative().max(100_000).optional(),
  })
  .strict();

function validateJsonSchema(value: Record<string, unknown>, context: z.RefinementCtx): void {
  const encoded = JSON.stringify(value);
  if (encoded.length > 100_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Plugin JSON Schema must not exceed 100,000 serialized characters',
    });
  }
  if (value['type'] !== 'object' || value['additionalProperties'] !== false) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Plugin tool schemas must be closed object schemas',
    });
  }
  const visit = (nested: unknown, path: Array<string | number>): void => {
    if (Array.isArray(nested)) {
      nested.forEach((entry, index) => visit(entry, [...path, index]));
      return;
    }
    if (nested === null || typeof nested !== 'object') return;
    for (const [key, entry] of Object.entries(nested as Record<string, unknown>)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, key],
          message: 'Prototype-mutating JSON Schema keys are forbidden',
        });
      }
      if (
        key === '$ref' &&
        (typeof entry !== 'string' ||
          (!entry.startsWith('#/$defs/') && !entry.startsWith('#/definitions/')))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...path, key],
          message: 'Only local JSON Schema references are allowed',
        });
      }
      visit(entry, [...path, key]);
    }
  };
  visit(value, []);
}

export const pluginJsonSchemaDocumentSchema = jsonObjectSchema.superRefine(validateJsonSchema);

export const pluginSecretSlotSchema = z
  .object({
    name: pluginIdentifierSchema,
    description: z.string().trim().min(10).max(500),
    required: z.boolean(),
    environmentVariable: environmentVariableNameSchema.optional(),
  })
  .strict();
export const pluginDeclaredSecretSlotSchema = pluginSecretSlotSchema
  .omit({ environmentVariable: true })
  .strict();

const secretSlotBindingSchema = z.object({ secretSlot: pluginIdentifierSchema }).strict();

const secureUrlSchema = z
  .string()
  .url()
  .max(2000)
  .superRefine((value, context) => {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Plugin URLs must use HTTPS' });
    }
    if (parsed.username !== '' || parsed.password !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plugin URLs must not contain credentials',
      });
    }
    if (parsed.hash !== '' || parsed.search !== '') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Plugin base URLs must not contain query strings or fragments',
      });
    }
  });

const hostNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/,
  )
  .max(253);

const relativeHttpPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .regex(/^\/[A-Za-z0-9._~!&'()*+,;=:@%{}/-]*$/)
  .refine(
    (value) => !value.includes('{') && !value.includes('}'),
    'HTTP Plugin path templates are not supported; pass bounded inputs as query parameters',
  )
  .refine((value) => !value.split('/').includes('..'), 'Parent path segments are forbidden');

const commonCapabilityShape = {
  tool: pluginIdentifierSchema,
  description: z.string().trim().min(10).max(1000),
  effect: pluginEffectSchema,
  approval: pluginApprovalRequirementSchema,
  scopeDescription: z.string().trim().min(10).max(500),
  inputSchema: pluginJsonSchemaDocumentSchema,
  outputSchema: pluginJsonSchemaDocumentSchema,
  limits: pluginLimitSchema,
};

const withEffectGuard = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  schema.superRefine((value, context) => {
    const candidate = value as { effect?: string; approval?: string };
    if (candidate.effect !== 'read' && candidate.approval !== 'approval_required') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['approval'],
        message: 'Write and destructive tools must require approval',
      });
    }
  });

export const httpPluginCapabilitySchema = withEffectGuard(
  z
    .object({
      ...commonCapabilityShape,
      invocation: z
        .object({
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
          path: relativeHttpPathSchema,
          headers: z.record(headerNameSchema, secretSlotBindingSchema).default({}),
        })
        .strict(),
    })
    .strict(),
).superRefine((value, context) => {
  if (value.invocation.method === 'GET' && value.effect !== 'read') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effect'],
      message: 'HTTP GET capabilities must declare read effect',
    });
  }
  if (value.invocation.method === 'DELETE' && value.effect !== 'destructive') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effect'],
      message: 'HTTP DELETE capabilities must declare destructive effect',
    });
  }
  if (
    (value.invocation.method === 'PUT' || value.invocation.method === 'PATCH') &&
    value.effect === 'read'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effect'],
      message: 'HTTP PUT and PATCH capabilities cannot declare read effect',
    });
  }
});

export const mcpPluginCapabilitySchema = withEffectGuard(
  z
    .object({
      ...commonCapabilityShape,
      invocation: z.object({ toolName: pluginIdentifierSchema }).strict(),
    })
    .strict(),
);

export const cliPluginCapabilitySchema = withEffectGuard(
  z
    .object({
      ...commonCapabilityShape,
      invocation: z
        .object({ args: z.array(commandArgumentSchema).max(100), shell: z.literal(false) })
        .strict(),
    })
    .strict(),
);

export const dbPluginCapabilitySchema = withEffectGuard(
  z
    .object({
      ...commonCapabilityShape,
      invocation: z
        .object({
          operation: z.enum(['query', 'dry_run', 'preview']),
          descriptor: pluginIdentifierSchema,
        })
        .strict(),
    })
    .strict(),
).superRefine((value, context) => {
  if (value.effect !== 'read') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effect'],
      message: 'Database query, dry-run, and preview capabilities must declare read effect',
    });
  }
});

const commonPluginShape = {
  executionPlacement: pluginExecutionPlacementSchema,
  classification: pluginClassificationSchema,
  secretSlots: z.array(pluginSecretSlotSchema).max(50),
};

const httpConnectionSchema = z
  .object({
    baseUrl: secureUrlSchema,
    allowedHosts: z.array(hostNameSchema).min(1).max(50),
    defaultHeaders: z.record(headerNameSchema, secretSlotBindingSchema).default({}),
  })
  .strict()
  .superRefine((value, context) => {
    const parsed = new URL(value.baseUrl);
    const host = parsed.hostname.toLowerCase();
    if (!value.allowedHosts.includes(host)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedHosts'],
        message: 'The base URL host must appear in allowedHosts',
      });
    }
    if (parsed.pathname !== '/') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseUrl'],
        message:
          'HTTP Plugin base URLs must use the origin root; routes belong in capability paths',
      });
    }
  });

const processConnectionSchema = z
  .object({
    executable: executableNameSchema,
    args: z.array(commandArgumentSchema).max(100),
    shell: z.literal(false),
    env: z.record(environmentVariableNameSchema, secretSlotBindingSchema).default({}),
  })
  .strict();

const remoteMcpConnectionSchema = z
  .object({
    mode: z.literal('remote'),
    endpoint: secureUrlSchema,
    allowedHosts: z.array(hostNameSchema).min(1).max(50),
    headers: z.record(headerNameSchema, secretSlotBindingSchema).default({}),
  })
  .strict()
  .superRefine((value, context) => {
    const host = new URL(value.endpoint).hostname.toLowerCase();
    if (!value.allowedHosts.includes(host)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedHosts'],
        message: 'The MCP endpoint host must appear in allowedHosts',
      });
    }
  });

const mcpConnectionSchema = z.union([
  remoteMcpConnectionSchema,
  processConnectionSchema.extend({ mode: z.literal('stdio') }).strict(),
]);

const healthBase = {
  intervalSeconds: z.number().int().min(30).max(86_400),
  timeoutMs: z.number().int().min(100).max(60_000),
};

const httpPluginSpecSchema = z
  .object({
    ...commonPluginShape,
    transport: z.literal('http'),
    connection: httpConnectionSchema,
    health: z
      .object({
        ...healthBase,
        kind: z.literal('http'),
        method: z.enum(['GET', 'HEAD']),
        path: relativeHttpPathSchema,
        expectedStatuses: z.array(z.number().int().min(100).max(599)).min(1).max(20),
      })
      .strict(),
    capabilities: z.array(httpPluginCapabilitySchema).min(1).max(100),
  })
  .strict();

const mcpPluginSpecSchema = z
  .object({
    ...commonPluginShape,
    transport: z.literal('mcp'),
    connection: mcpConnectionSchema,
    health: z
      .object({ ...healthBase, kind: z.literal('mcp'), tool: pluginIdentifierSchema.nullable() })
      .strict(),
    capabilities: z.array(mcpPluginCapabilitySchema).min(1).max(100),
  })
  .strict();

const cliPluginSpecSchema = z
  .object({
    ...commonPluginShape,
    transport: z.literal('cli'),
    connection: processConnectionSchema,
    health: z
      .object({
        ...healthBase,
        kind: z.literal('cli'),
        args: z.array(commandArgumentSchema).max(50),
      })
      .strict(),
    capabilities: z.array(cliPluginCapabilitySchema).min(1).max(100),
  })
  .strict();

const dbPluginSpecSchema = z
  .object({
    ...commonPluginShape,
    transport: z.literal('db'),
    connection: z
      .object({
        driver: z.enum(['bigquery', 'postgresql']),
        descriptorRegistry: z.string().trim().min(1).max(500),
        credentialSlots: z.array(pluginIdentifierSchema).max(20),
        region: z.string().trim().min(1).max(100),
      })
      .strict(),
    health: z
      .object({ ...healthBase, kind: z.literal('db'), operation: z.enum(['dry_run', 'ping']) })
      .strict(),
    capabilities: z.array(dbPluginCapabilitySchema).min(1).max(100),
  })
  .strict();

export const pluginResourceSpecSchema = z
  .discriminatedUnion('transport', [
    mcpPluginSpecSchema,
    httpPluginSpecSchema,
    cliPluginSpecSchema,
    dbPluginSpecSchema,
  ])
  .superRefine((value, context) => {
    const slotNames = new Set(value.secretSlots.map(({ name }) => name));
    if (slotNames.size !== value.secretSlots.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secretSlots'],
        message: 'Secret-slot names must be unique',
      });
    }
    const tools = new Set(value.capabilities.map(({ tool }) => tool));
    if (tools.size !== value.capabilities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capabilities'],
        message: 'Plugin tool names must be unique',
      });
    }
    const referencedSlots: string[] = [];
    const collectBindings = (candidate: unknown): void => {
      if (candidate === null || typeof candidate !== 'object') return;
      if (Array.isArray(candidate)) {
        candidate.forEach(collectBindings);
        return;
      }
      for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
        if (key === 'secretSlot' && typeof nested === 'string' && !slotNames.has(nested)) {
          referencedSlots.push(nested);
        }
        collectBindings(nested);
      }
    };
    collectBindings(value.connection);
    collectBindings(value.capabilities);
    for (const slot of referencedSlots) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['secretSlots'],
        message: `Connection references undeclared secret slot ${slot}`,
      });
    }
    if (value.transport === 'db') {
      for (const slot of value.connection.credentialSlots) {
        if (!slotNames.has(slot)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['connection', 'credentialSlots'],
            message: `Database connection references undeclared secret slot ${slot}`,
          });
        }
      }
    }
  });

export const requestedPluginAuthorityScopeSchema = z
  .object({
    installationId: uuidSchema,
    pluginVersionId: uuidSchema,
    tool: pluginIdentifierSchema,
    limits: pluginLimitSchema,
  })
  .strict();

export const pluginAuthorityScopeSchema = requestedPluginAuthorityScopeSchema
  .extend({
    pluginDigest: sha256Schema,
    effect: pluginEffectSchema,
    scopeDescription: z.string().trim().min(10).max(500),
  })
  .strict();

export const pluginPackEntrySchema = z
  .object({
    plugin: exactPluginReferenceSchema,
    defaultScopes: z
      .array(
        z
          .object({
            tool: pluginIdentifierSchema,
            limits: pluginLimitSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const pluginPackSpecSchema = z
  .object({
    description: z.string().trim().min(10).max(1000),
    plugins: z.array(pluginPackEntrySchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const refs = value.plugins.map(
      ({ plugin }) => `${plugin.familyId.toLowerCase()}@${plugin.version}`,
    );
    if (new Set(refs).size !== refs.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plugins'],
        message: 'A PluginPack cannot pin the same Plugin version more than once',
      });
    }
    value.plugins.forEach((entry, pluginIndex) => {
      const tools = entry.defaultScopes.map(({ tool }) => tool);
      if (new Set(tools).size !== tools.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['plugins', pluginIndex, 'defaultScopes'],
          message: 'A PluginPack cannot grant the same tool more than once',
        });
      }
    });
  });

export const runPluginRequirementSchema = pluginAuthorityScopeSchema
  .extend({
    executionPlacement: pluginExecutionPlacementSchema,
    /** This exact run needs its own human decision; a reusable envelope is insufficient. */
    approvalRequired: z.boolean(),
  })
  .strict();

export const pluginInstallationStateSchema = z.enum([
  'installed',
  'enabled',
  'disabled',
  'degraded',
]);
export const pluginHealthStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'unavailable']);

export const pluginCapabilitySummarySchema = z.object({
  tool: pluginIdentifierSchema,
  description: z.string(),
  effect: pluginEffectSchema,
  approval: pluginApprovalRequirementSchema,
  scopeDescription: z.string(),
  limits: pluginLimitSchema,
});

export const pluginCatalogItemSchema = z.object({
  pluginVersionId: uuidSchema,
  familyId: uuidSchema,
  slug: z.string(),
  name: z.string(),
  version: semanticVersionSchema,
  digest: sha256Schema,
  transport: pluginTransportSchema,
  executionPlacement: pluginExecutionPlacementSchema,
  classification: pluginClassificationSchema,
  capabilities: z.array(pluginCapabilitySummarySchema),
  secretSlots: z.array(pluginDeclaredSecretSlotSchema),
  activeScopeDescriptions: z.array(z.string().trim().min(10).max(500)).max(100),
  costThisWeekUsd: z.number().finite().nonnegative(),
  installationId: uuidSchema.nullable(),
  installationState: pluginInstallationStateSchema.nullable(),
  healthStatus: pluginHealthStatusSchema,
  lastUsedAt: isoDateTimeSchema.nullable(),
});
export const pluginCatalogQuerySchema = z.object({
  transport: pluginTransportSchema.optional(),
  executionPlacement: pluginExecutionPlacementSchema.optional(),
  classification: pluginClassificationSchema.optional(),
  includeDisabled: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const pluginCatalogResponseSchema = z.object({ items: z.array(pluginCatalogItemSchema) });

export const pluginSecretReferenceSchema = z
  .string()
  .trim()
  .regex(/^(?:env|secret-manager|windows-credential|keychain):\/\/[A-Za-z0-9_./:@-]+$/)
  .max(500)
  .describe('Opaque secret reference only; never a credential value.');
export const pluginSecretBindingRequestSchema = z
  .object({ slot: pluginIdentifierSchema, reference: pluginSecretReferenceSchema })
  .strict();
export const pluginSecretBindingStatusSchema = z
  .object({ slot: pluginIdentifierSchema, configured: z.boolean() })
  .strict();

export const installPluginRequestSchema = z
  .object({
    pluginVersionId: uuidSchema,
    developmentOnly: z.boolean().default(false),
    secretBindings: z.array(pluginSecretBindingRequestSchema).max(50).default([]),
  })
  .strict();
export const configurePluginInstallationRequestSchema = z
  .object({
    secretBindings: z.array(pluginSecretBindingRequestSchema).max(50),
    rationale: z.string().trim().min(10).max(2000),
  })
  .strict();
export const pluginInstallationSchema = z.object({
  id: uuidSchema,
  pluginVersionId: uuidSchema,
  pluginDigest: sha256Schema,
  state: pluginInstallationStateSchema,
  executionPlacement: pluginExecutionPlacementSchema,
  developmentOnly: z.boolean(),
  secretBindings: z.array(pluginSecretBindingStatusSchema),
  installedBy: z.string(),
  installedAt: isoDateTimeSchema,
  configuredAt: isoDateTimeSchema.nullable(),
  disabledAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export const pluginInstallationListQuerySchema = z.object({
  state: pluginInstallationStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const pluginInstallationListResponseSchema = z.object({
  items: z.array(pluginInstallationSchema),
});

export const pluginHealthCheckSchema = z.object({
  id: uuidSchema,
  installationId: uuidSchema,
  status: pluginHealthStatusSchema,
  probeKind: z.enum(['mcp', 'http', 'cli', 'db']),
  message: z.string().trim().min(1).max(1000),
  latencyMs: z.number().int().nonnegative().nullable(),
  checkedAt: isoDateTimeSchema,
});
export const pluginUsedByItemSchema = z.object({
  kind: z.enum(['resource', 'release', 'deployment']),
  id: uuidSchema,
  name: z.string().trim().min(1).max(200),
  lifecycle: z.string().trim().min(1).max(80),
  digest: sha256Schema.nullable(),
});
export const pluginUsedByResponseSchema = z.object({
  installationId: uuidSchema,
  items: z.array(pluginUsedByItemSchema),
  uninstallBlocked: z.boolean(),
});
export const pluginStateChangeRequestSchema = z
  .object({ rationale: z.string().trim().min(10).max(2000) })
  .strict();
export const uninstallPluginRequestSchema = pluginStateChangeRequestSchema;

export const pluginInvocationStateSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused_plugin',
]);
export const pluginInvocationSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  installationId: uuidSchema,
  pluginVersionId: uuidSchema,
  pluginDigest: sha256Schema,
  tool: pluginIdentifierSchema,
  effect: pluginEffectSchema,
  state: pluginInvocationStateSchema,
  requestDigest: sha256Schema,
  responseDigest: sha256Schema.nullable(),
  error: jsonObjectSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export type PluginResourceSpec = z.infer<typeof pluginResourceSpecSchema>;
export type PluginPackSpec = z.infer<typeof pluginPackSpecSchema>;
export type PluginAuthorityScope = z.infer<typeof pluginAuthorityScopeSchema>;
export type RunPluginRequirement = z.infer<typeof runPluginRequirementSchema>;
export type PluginInstallation = z.infer<typeof pluginInstallationSchema>;
