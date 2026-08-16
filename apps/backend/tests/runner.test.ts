import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  agentManifestSchema,
  generatorInputSchema,
  type AgentManifest,
  type GeneratorInput,
} from '@agent-builder/contracts';
import {
  CliGeneratorRunner,
  generatorEnvironment,
  type GeneratorRunnerError,
} from '../src/generation/runner.js';

type SpawnStub = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

function fakeChildProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = jest.fn((signal?: NodeJS.Signals | number) => {
    void signal;
    return true;
  });
  const child = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill,
  }) as unknown as ChildProcess;
  return { child, stdout, stderr, kill };
}

function outputPath(args: readonly string[]): string {
  const index = args.indexOf('--output');
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error('Runner did not provide --output');
  return value;
}

const input: GeneratorInput = generatorInputSchema.parse({
  agentId: '1278447b-3f71-40bc-a5ea-1d680c1a66d0',
  spec: {
    id: '35f4c5c2-9129-46c5-87a5-a89ed7af62bd',
    agentId: '1278447b-3f71-40bc-a5ea-1d680c1a66d0',
    baseAgentId: null,
    status: 'ready',
    revision: 4,
    outcomes: {
      name: 'Supplier Risk Analyst',
      department: 'Supply Chain',
      purpose: 'Identify supplier delays and prepare an evidence-backed escalation brief.',
      audience: 'Supply chain leaders',
      desiredOutcomes: ['Identify impacted builds'],
      humanBaseline: 'An analyst performs the investigation manually.',
      exclusions: ['Do not contact suppliers'],
    },
    knowledge: {
      sources: [
        {
          descriptorId: 'confluence-supplier-playbook',
          purpose: 'Use the governed escalation process',
          requiredCitations: true,
        },
      ],
    },
    guardrails: {
      workflowStages: ['Collect evidence', 'Prepare recommendation'],
      prohibitedActions: ['Do not contact suppliers'],
      approvalRequirements: ['Require supply chain lead approval'],
      failClosedConditions: ['Stop when evidence is unavailable'],
      responseRequirements: {
        citations: true,
        confidence: true,
        unresolvedConflicts: true,
      },
    },
    outputs: {
      outputType: 'decision_brief',
      outputSchema: { riskLevel: 'string' },
      successMetrics: [
        {
          name: 'Evidence coverage',
          operator: 'gte',
          threshold: 0.95,
          unit: 'ratio',
        },
      ],
      acceptanceTests: [
        {
          name: 'Known supplier delay',
          input: { supplier: 'Fixture Supplier' },
          expectedResult: { riskLevel: 'high' },
        },
      ],
    },
  },
});

const manifest: AgentManifest = agentManifestSchema.parse({
  agentId: input.agentId,
  name: input.spec.outcomes.name,
  department: input.spec.outcomes.department,
  purpose: input.spec.outcomes.purpose,
  version: '0.1.4',
  specRevision: input.spec.revision,
  generatorVersion: '0.2.0',
  workflow: input.spec.guardrails.workflowStages,
  knowledgeSourceIds: ['confluence-supplier-playbook'],
  guardrails: input.spec.guardrails,
  outputType: input.spec.outputs.outputType,
  outputSchema: input.spec.outputs.outputSchema,
  evaluations: input.spec.outputs.acceptanceTests,
  generatedAt: '2026-07-31T12:00:00.000Z',
});

function runner(
  spawnProcess: SpawnStub,
  overrides: Partial<{
    generatorTimeoutMs: number;
    generatorMaxOutputBytes: number;
  }> = {},
): CliGeneratorRunner {
  return new CliGeneratorRunner(
    {
      generatorCliPath: '/fixed/generator-cli.js',
      generatorTimeoutMs: overrides.generatorTimeoutMs ?? 10_000,
      generatorMaxOutputBytes: overrides.generatorMaxOutputBytes ?? 1_000_000,
    },
    spawnProcess,
  );
}

describe('CliGeneratorRunner', () => {
  it('passes only PATH and NODE_ENV to the generator subprocess', () => {
    expect(
      generatorEnvironment({
        PATH: '/safe/bin',
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://sensitive',
        OPENAI_API_KEY: 'sensitive',
        GOOGLE_APPLICATION_CREDENTIALS: '/sensitive/adc.json',
      }),
    ).toEqual({ PATH: '/safe/bin', NODE_ENV: 'test' });
  });

  it('parses a progress event split across chunks and flushes an unterminated line', async () => {
    const progress = jest.fn();
    const spawnProcess: SpawnStub = (_command, args) => {
      const { child, stdout } = fakeChildProcess();
      const line = JSON.stringify({
        type: 'progress',
        progress: 35,
        message: 'Composing workflow',
      });
      queueMicrotask(() => {
        void writeFile(outputPath(args), JSON.stringify(manifest), 'utf8').then(
          () => {
            stdout.write(line.slice(0, 11));
            stdout.write(line.slice(11));
            child.emit('close', 0, null);
          },
          (error: unknown) => child.emit('error', error),
        );
      });
      return child;
    };

    await expect(runner(spawnProcess).run(input, progress)).resolves.toEqual(manifest);
    expect(progress).toHaveBeenCalledWith({
      type: 'progress',
      progress: 35,
      message: 'Composing workflow',
    });
  });

  it('fails and kills the child when progress output is malformed', async () => {
    const { child, stdout, kill } = fakeChildProcess();
    const spawnProcess: SpawnStub = () => {
      queueMicrotask(() => stdout.write('not-json\n'));
      return child;
    };

    await expect(runner(spawnProcess).run(input, jest.fn())).rejects.toMatchObject<
      Partial<GeneratorRunnerError>
    >({
      code: 'MALFORMED_PROGRESS',
    });
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('reports a non-zero child exit and includes bounded stderr', async () => {
    const { child, stderr } = fakeChildProcess();
    const spawnProcess: SpawnStub = () => {
      queueMicrotask(() => {
        stderr.write('generator failed');
        child.emit('close', 7, null);
      });
      return child;
    };

    await expect(runner(spawnProcess).run(input, jest.fn())).rejects.toMatchObject({
      code: 'GENERATOR_EXITED',
      message: expect.stringContaining('generator failed'),
    });
  });

  it('rejects a successful exit that does not create a manifest', async () => {
    const { child } = fakeChildProcess();
    const spawnProcess: SpawnStub = () => {
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    };

    await expect(runner(spawnProcess).run(input, jest.fn())).rejects.toMatchObject({
      code: 'GENERATOR_OUTPUT_MISSING',
    });
  });

  it('rejects a manifest that fails the shared contract', async () => {
    const spawnProcess: SpawnStub = (_command, args) => {
      const { child } = fakeChildProcess();
      queueMicrotask(() => {
        void writeFile(outputPath(args), JSON.stringify({ invalid: true }), 'utf8').then(
          () => child.emit('close', 0, null),
          (error: unknown) => child.emit('error', error),
        );
      });
      return child;
    };

    await expect(runner(spawnProcess).run(input, jest.fn())).rejects.toMatchObject({
      code: 'GENERATOR_OUTPUT_INVALID',
    });
  });

  it('kills the child when combined output exceeds the configured limit', async () => {
    const { child, stdout, kill } = fakeChildProcess();
    const spawnProcess: SpawnStub = () => {
      queueMicrotask(() => stdout.write(Buffer.alloc(17, 'x')));
      return child;
    };

    await expect(
      runner(spawnProcess, { generatorMaxOutputBytes: 16 }).run(input, jest.fn()),
    ).rejects.toMatchObject({
      code: 'GENERATOR_OUTPUT_LIMIT',
    });
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('reports child-process spawn errors', async () => {
    const { child } = fakeChildProcess();
    const spawnProcess: SpawnStub = () => {
      queueMicrotask(() => child.emit('error', new Error('permission denied')));
      return child;
    };

    await expect(runner(spawnProcess).run(input, jest.fn())).rejects.toMatchObject({
      code: 'GENERATOR_SPAWN_FAILED',
      message: expect.stringContaining('permission denied'),
    });
  });

  it('times out and kills the child without a real delay', async () => {
    jest.useFakeTimers();
    try {
      const { child, kill } = fakeChildProcess();
      let markSpawned: (() => void) | undefined;
      const spawned = new Promise<void>((resolve) => {
        markSpawned = resolve;
      });
      const spawnProcess: SpawnStub = () => {
        markSpawned?.();
        return child;
      };
      const runPromise = runner(spawnProcess, { generatorTimeoutMs: 5_000 }).run(input, jest.fn());
      await spawned;
      const assertion = expect(runPromise).rejects.toMatchObject({
        code: 'GENERATOR_TIMEOUT',
      });

      jest.runOnlyPendingTimers();

      await assertion;
      expect(kill).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
