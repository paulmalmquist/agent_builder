import { randomUUID } from 'node:crypto';
import {
  BuilderDecisionAction,
  BuilderIntakeState,
  EvalCaseSource,
  PrismaClient,
  ResourceKind,
} from '@prisma/client';

const databaseEnabled =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = databaseEnabled ? describe : describe.skip;
const prisma = new PrismaClient();

class ExpectedRollback extends Error {}

describeDatabase('workspace-local natural and idempotency uniqueness', () => {
  afterAll(async () => prisma.$disconnect());

  it('accepts the same governed names, versions, channels, and decision keys in two workspaces', async () => {
    const suffix = randomUUID();
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const familyA = randomUUID();
    const familyB = randomUUID();

    await prisma
      .$transaction(async (transaction) => {
        await transaction.workspace.createMany({
          data: [
            { id: workspaceA, slug: `unique-a-${suffix}`, name: 'Uniqueness A' },
            { id: workspaceB, slug: `unique-b-${suffix}`, name: 'Uniqueness B' },
          ],
        });

        for (const [workspaceId, familyId] of [
          [workspaceA, familyA],
          [workspaceB, familyB],
        ] as const) {
          await transaction.agentFamily.create({
            data: {
              id: familyId,
              workspaceId,
              slug: 'shared-agent',
              name: 'Shared Agent',
              department: 'Synthetic',
              owner: 'Synthetic Owner',
              createdBy: 'system:uniqueness-test',
              updatedBy: 'system:uniqueness-test',
            },
          });
          await transaction.agent.create({
            data: {
              familyId,
              slug: 'shared-agent-v1',
              versionNumber: 1,
              name: 'Shared Agent',
              department: 'Synthetic',
              purpose: 'Verify workspace-local uniqueness.',
              owner: 'Synthetic Owner',
              createdBy: 'system:uniqueness-test',
              updatedBy: 'system:uniqueness-test',
            },
          });
          await transaction.knowledgeSource.create({
            data: {
              id: 'shared-source',
              workspaceId,
              role: 'KNOWLEDGE',
              provider: 'FIXTURE',
              displayName: 'Shared Source',
              uri: 'fixture://workspace/shared-source',
              authority: 'SYSTEM_OF_RECORD',
              owner: 'Synthetic Owner',
            },
          });
          await transaction.certificationGateConfig.create({
            data: {
              workspaceId,
              version: 1,
              promotionFreshnessHours: 24,
              gates: {},
              publishedBy: 'human:uniqueness-test',
              rationale: 'Verify workspace-local version allocation.',
            },
          });
          await transaction.evalCase.create({
            data: {
              workspaceId,
              key: 'shared-eval-case',
              name: 'Shared evaluation case',
              input: {},
              expectedOutput: {},
              tags: [],
              source: EvalCaseSource.SEED,
              createdBy: 'system:uniqueness-test',
              updatedBy: 'system:uniqueness-test',
            },
          });
          await transaction.evalCorpusVersion.create({
            data: {
              workspaceId,
              version: 1,
              contentHash:
                `${workspaceId.replaceAll('-', '')}00000000000000000000000000000000`.slice(0, 64),
              publishedBy: 'human:uniqueness-test',
              rationale: 'Verify workspace-local corpus numbering.',
            },
          });
          await transaction.resourceFamily.create({
            data: {
              id: randomUUID(),
              workspaceId,
              kind: ResourceKind.SKILL,
              slug: 'shared-skill',
              name: 'Shared Skill',
              createdBy: 'system:uniqueness-test',
              updatedBy: 'system:uniqueness-test',
            },
          });
          await transaction.productionChannel.create({
            data: { workspaceId, key: 'shared-channel', projectId: 'shared-project' },
          });
          await transaction.observation.create({
            data: {
              workspaceId,
              signalKey: 'shared-signal',
              signalType: 'synthetic.uniqueness',
              summary: 'Verify workspace-local observation idempotency.',
              observedBy: 'system:uniqueness-test',
            },
          });
          const intake = await transaction.builderIntake.create({
            data: {
              workspaceId,
              request: 'Build a synthetic capability.',
              requestedBy: 'human:uniqueness-test',
              departmentLabel: 'Synthetic',
              state: BuilderIntakeState.CONFIRMED,
              capabilityProfile: {},
              confirmedAt: new Date(),
            },
          });
          await transaction.builderDecision.create({
            data: {
              workspaceId,
              intakeId: intake.id,
              idempotencyKey: 'shared-builder-decision',
              action: BuilderDecisionAction.BUILD_NEW,
              buildNewReason: null,
              decidedBy: 'human:uniqueness-test',
            },
          });
        }
        throw new ExpectedRollback('rollback successful cross-workspace fixture');
      })
      .catch((error: unknown) => {
        if (!(error instanceof ExpectedRollback)) throw error;
      });
  });

  it('still rejects duplicate natural keys inside one workspace', async () => {
    const workspaceId = randomUUID();
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.workspace.create({
          data: { id: workspaceId, slug: `same-${workspaceId}`, name: 'Same workspace' },
        });
        const common = {
          workspaceId,
          slug: 'duplicate-agent',
          name: 'Duplicate Agent',
          department: 'Synthetic',
          owner: 'Synthetic Owner',
          createdBy: 'system:uniqueness-test',
          updatedBy: 'system:uniqueness-test',
        };
        await transaction.agentFamily.create({ data: common });
        await transaction.agentFamily.create({ data: common });
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('scopes operational idempotency indexes to a workspace or owning aggregate', async () => {
    const expected = new Map([
      ['ExecutionRun_workspaceId_idempotencyKey_key', '"workspaceId"'],
      ['RunStep_runId_idempotencyKey_key', '"runId"'],
      ['PluginInvocation_workspaceId_invocationKey_sequence_key', '"workspaceId"'],
      ['RunPluginCallPlan_workspaceId_invocationKey_key', '"workspaceId"'],
      ['AutomationDispatch_scheduleId_idempotencyKey_key', '"scheduleId"'],
      ['DigestDeliveryAttempt_workspaceId_attemptKey_key', '"workspaceId"'],
      ['CatalogIndexOutbox_workspaceId_idempotencyKey_key', '"workspaceId"'],
    ]);
    const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `;
    const byName = new Map(indexes.map((index) => [index.indexname, index.indexdef]));
    for (const [name, scopeColumn] of expected) {
      expect(byName.get(name)).toContain(scopeColumn);
    }
  });
});
