/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import type { PrismaClient } from '@prisma/client';
import { interpretSpecResponseSchema, type InterpretSpecResponse } from '@agent-builder/contracts';
import { AppError } from '../src/errors.js';
import { HeuristicSpecInterpreter, type SpecInterpreter } from '../src/interpretation/heuristic.js';
import { InterpretationService } from '../src/services/interpretation-service.js';

const SPEC_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const CANDIDATE_ID = 'supplier-delay-scope';

function parentResult(kind: 'prefill' | 'split_required'): InterpretSpecResponse {
  if (kind === 'split_required') {
    return interpretSpecResponseSchema.parse({
      kind,
      interpretationId: PARENT_ID,
      parentInterpretationId: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      candidates: [
        {
          id: CANDIDATE_ID,
          name: 'Supplier delay',
          purpose: 'Create a governed supplier delay decision brief.',
          trigger: 'When a supplier delivery is delayed',
          outcome: 'Notify the governed supply chain owner',
        },
        {
          id: 'inventory-risk-scope',
          name: 'Inventory risk',
          purpose: 'Create a governed inventory risk decision brief.',
          trigger: 'When inventory falls below its buffer',
          outcome: 'Notify the governed inventory owner',
        },
      ],
    });
  }

  const interpreted = new HeuristicSpecInterpreter().interpret(
    'Describe a governed supplier delay briefing workflow for the operations team.',
    [],
  );
  if (interpreted.kind !== 'prefill' || interpreted.draft === null) {
    throw new Error('Expected the fixture interpreter to return a prefill');
  }
  const mapSection = <T>(section: {
    value: T | null;
    confidence: 'high' | 'medium' | 'low';
    needsReview: boolean;
  }) => ({ ...section, unresolved: [] });
  return interpretSpecResponseSchema.parse({
    kind,
    interpretationId: PARENT_ID,
    parentInterpretationId: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    sections: {
      outcomes: mapSection(interpreted.draft.outcomes),
      knowledge: mapSection(interpreted.draft.knowledge),
      guardrails: mapSection(interpreted.draft.guardrails),
      outputs: mapSection(interpreted.draft.outputs),
    },
    authorityWarnings: interpreted.draft.authorityWarnings,
    reuseQuery: interpreted.draft.reuseQuery,
  });
}

function createPrisma(
  overrides: {
    agentSpecs?: unknown[];
    parent?: unknown;
    records?: unknown[];
    deleteCounts?: number[];
  } = {},
) {
  const create = jest.fn(async () => ({ id: 'created-interpretation' }));
  const auditCreate = jest.fn(async () => ({ id: 'audit-event' }));
  const agentSpecFindUnique = jest.fn();
  for (const value of overrides.agentSpecs ?? []) {
    agentSpecFindUnique.mockResolvedValueOnce(value);
  }
  const specInterpretationFindUnique = jest.fn(async () => overrides.parent ?? null);
  const specInterpretationFindMany = jest.fn(async () => overrides.records ?? []);
  const deleteMany = jest.fn();
  for (const count of overrides.deleteCounts ?? []) {
    deleteMany.mockResolvedValueOnce({ count });
  }
  deleteMany.mockResolvedValue({ count: 1 });
  const transaction = {
    specInterpretation: { create },
    auditEvent: { create: auditCreate },
  };
  const prisma = {
    agentSpec: { findUnique: agentSpecFindUnique, findFirst: agentSpecFindUnique },
    knowledgeSource: { findMany: jest.fn(async () => []) },
    specInterpretation: {
      findUnique: specInterpretationFindUnique,
      findFirst: specInterpretationFindUnique,
      findMany: specInterpretationFindMany,
      deleteMany,
    },
    $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
      operation(transaction),
    ),
  } as unknown as PrismaClient;
  return {
    prisma,
    create,
    deleteMany,
    agentSpecFindUnique,
    specInterpretationFindUnique,
  };
}

describe('InterpretationService dependency boundary', () => {
  it('fails closed with a typed 503 when the interpreter adapter is unavailable', async () => {
    const transaction = jest.fn();
    const prisma = {
      knowledgeSource: { findMany: jest.fn(() => Promise.resolve([])) },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const interpreter: SpecInterpreter = {
      interpret: jest.fn(() => Promise.reject(new Error('provider timeout with secret body'))),
    };
    const service = new InterpretationService(prisma, 24, interpreter);

    await expect(
      service.interpret({
        kind: 'prompt',
        prompt: 'Describe a governed supplier delay briefing workflow.',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Specification interpretation is temporarily unavailable',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('preserves typed AppErrors returned by the interpreter adapter', async () => {
    const { prisma } = createPrisma();
    const dependencyError = new AppError(409, 'RESOURCE_CONFLICT', 'Fixture conflict');
    const interpreter: SpecInterpreter = {
      interpret: jest.fn(async () => Promise.reject(dependencyError)),
    };

    await expect(
      new InterpretationService(prisma, 24, interpreter).interpret({
        kind: 'prompt',
        prompt: 'Describe a governed supplier delay briefing workflow.',
      }),
    ).rejects.toBe(dependencyError);
  });
});

describe('InterpretationService lineage and locking', () => {
  it('rejects a missing target specification before invoking the interpreter', async () => {
    const { prisma } = createPrisma({ agentSpecs: [null] });
    const interpreter: SpecInterpreter = { interpret: jest.fn() };

    await expect(
      new InterpretationService(prisma, 24, interpreter).interpret({
        kind: 'prompt',
        prompt: 'Describe a governed supplier delay briefing workflow.',
        specId: SPEC_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'SPEC_NOT_FOUND' });
    expect(interpreter.interpret).not.toHaveBeenCalled();
  });

  it('rejects a target that disappears after lineage lookup', async () => {
    const { prisma } = createPrisma({
      agentSpecs: [{ interpretationId: PARENT_ID }, null],
    });

    await expect(
      new InterpretationService(prisma, 24).interpret({
        kind: 'prompt',
        prompt: 'Describe a governed supplier delay briefing workflow.',
        specId: SPEC_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'SPEC_NOT_FOUND' });
  });

  it.each(['GENERATING', 'GENERATED'] as const)(
    'rejects interpretation of a %s specification',
    async (status) => {
      const { prisma } = createPrisma({
        agentSpecs: [
          { interpretationId: PARENT_ID },
          { status, outcomes: null, knowledge: null, guardrails: null, outputs: null },
        ],
      });

      await expect(
        new InterpretationService(prisma, 24).interpret({
          kind: 'prompt',
          prompt: 'Describe a governed supplier delay briefing workflow.',
          specId: SPEC_ID,
        }),
      ).rejects.toMatchObject({ status: 409, code: 'SPEC_LOCKED' });
    },
  );

  it('preserves confirmed sections and maps authority warnings into typed unresolved items', async () => {
    const { prisma, create } = createPrisma({
      agentSpecs: [
        { interpretationId: PARENT_ID },
        {
          status: 'DRAFT',
          outcomes: { confirmed: true },
          knowledge: null,
          guardrails: { confirmed: true },
          outputs: null,
        },
      ],
    });
    const response = await new InterpretationService(prisma, 24).interpret({
      kind: 'prompt',
      prompt:
        'Create a governed supplier workflow that can write production supplier records after human approval.',
      specId: SPEC_ID,
    });

    expect(response.kind).toBe('prefill');
    if (response.kind !== 'prefill') throw new Error('Expected prefill');
    expect(response.parentInterpretationId).toBe(PARENT_ID);
    expect(response.sections.outcomes.value).toBeNull();
    expect(response.sections.guardrails.value).toBeNull();
    expect(response.sections.knowledge.value).toBeNull();
    expect(response.sections.guardrails.unresolved).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'authority' })]),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('InterpretationService split selection', () => {
  it('persists a multi-agent prompt as server-owned split candidates', async () => {
    const { prisma, create } = createPrisma();
    const response = await new InterpretationService(prisma, 24).interpret({
      kind: 'prompt',
      prompt:
        'When a supplier slips then prepare a delay brief and also separately when inventory is low then prepare a replenishment brief.',
    });

    expect(response.kind).toBe('split_required');
    if (response.kind !== 'split_required') throw new Error('Expected split candidates');
    expect(response.candidates).toHaveLength(2);
    expect(response.candidates.every((candidate) => candidate.id.length > 0)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing parent', async () => {
    const { prisma } = createPrisma();
    await expect(
      new InterpretationService(prisma, 24).interpret({
        kind: 'split_selection',
        parentInterpretationId: PARENT_ID,
        candidateId: CANDIDATE_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: 'INTERPRETATION_NOT_FOUND' });
  });

  it('rejects an expired parent', async () => {
    const { prisma } = createPrisma({
      parent: {
        id: PARENT_ID,
        expiresAt: new Date(Date.now() - 60_000),
        result: parentResult('split_required'),
      },
    });
    await expect(
      new InterpretationService(prisma, 24).interpret({
        kind: 'split_selection',
        parentInterpretationId: PARENT_ID,
        candidateId: CANDIDATE_ID,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'INTERPRETATION_EXPIRED' });
  });

  it('rejects a parent without split candidates', async () => {
    const { prisma } = createPrisma({
      parent: {
        id: PARENT_ID,
        expiresAt: new Date(Date.now() + 60_000),
        result: parentResult('prefill'),
      },
    });
    await expect(
      new InterpretationService(prisma, 24).interpret({
        kind: 'split_selection',
        parentInterpretationId: PARENT_ID,
        candidateId: CANDIDATE_ID,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'INTERPRETATION_NOT_SPLITTABLE' });
  });

  it('rejects an unknown split candidate', async () => {
    const { prisma } = createPrisma({
      parent: {
        id: PARENT_ID,
        expiresAt: new Date(Date.now() + 60_000),
        result: parentResult('split_required'),
      },
    });
    await expect(
      new InterpretationService(prisma, 24).interpret({
        kind: 'split_selection',
        parentInterpretationId: PARENT_ID,
        candidateId: 'unknown-candidate',
      }),
    ).rejects.toMatchObject({ status: 404, code: 'SPLIT_CANDIDATE_NOT_FOUND' });
  });

  it('persists the selected child under its split parent', async () => {
    const { prisma, create } = createPrisma({
      parent: {
        id: PARENT_ID,
        expiresAt: new Date(Date.now() + 60_000),
        result: parentResult('split_required'),
      },
    });
    const response = await new InterpretationService(prisma, 24).interpret({
      kind: 'split_selection',
      parentInterpretationId: PARENT_ID,
      candidateId: CANDIDATE_ID,
    });

    expect(response.kind).toBe('prefill');
    expect(response.parentInterpretationId).toBe(PARENT_ID);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ parentInterpretationId: PARENT_ID }),
      }),
    );
  });
});

describe('InterpretationService expiry janitor', () => {
  const expired = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  it('keeps ancestors of attached, confirmed, and unexpired descendants', async () => {
    const records = [
      {
        id: 'root',
        parentInterpretationId: null,
        expiresAt: expired,
        attachedSpec: null,
        _count: { confirmations: 0 },
      },
      {
        id: 'attached',
        parentInterpretationId: 'root',
        expiresAt: expired,
        attachedSpec: { id: SPEC_ID },
        _count: { confirmations: 0 },
      },
      {
        id: 'confirmed',
        parentInterpretationId: 'root',
        expiresAt: expired,
        attachedSpec: null,
        _count: { confirmations: 1 },
      },
      {
        id: 'future',
        parentInterpretationId: 'root',
        expiresAt: future,
        attachedSpec: null,
        _count: { confirmations: 0 },
      },
    ];
    const { prisma, deleteMany } = createPrisma({ records });

    await expect(new InterpretationService(prisma, 24).deleteExpiredUnattached()).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('deletes an unprotected expired tree from leaves to roots', async () => {
    const records = [
      {
        id: 'root',
        parentInterpretationId: null,
        expiresAt: expired,
        attachedSpec: null,
        _count: { confirmations: 0 },
      },
      {
        id: 'child',
        parentInterpretationId: 'root',
        expiresAt: expired,
        attachedSpec: null,
        _count: { confirmations: 0 },
      },
      {
        id: 'grandchild',
        parentInterpretationId: 'child',
        expiresAt: expired,
        attachedSpec: null,
        _count: { confirmations: 0 },
      },
    ];
    const { prisma, deleteMany } = createPrisma({ records, deleteCounts: [1, 1, 1] });

    await expect(new InterpretationService(prisma, 24).deleteExpiredUnattached()).resolves.toBe(3);
    const deletedIds = deleteMany.mock.calls.map(
      ([argument]: [{ where: { id: string } }]) => argument.where.id,
    );
    expect(deletedIds).toEqual(['grandchild', 'child', 'root']);
  });
});
