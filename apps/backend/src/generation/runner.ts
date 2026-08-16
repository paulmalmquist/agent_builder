import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  agentManifestSchema,
  generatorInputSchema,
  generatorProgressSchema,
  type AgentManifest,
  type GeneratorInput,
  type GeneratorProgress,
} from '@agent-builder/contracts';
import type { AppConfig } from '../config.js';
import { errorMessage } from '../errors.js';

export interface GeneratorRunner {
  run(
    input: GeneratorInput,
    onProgress: (progress: GeneratorProgress) => Promise<void> | void,
  ): Promise<AgentManifest>;
}

export class GeneratorRunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GeneratorRunnerError';
  }
}

type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export function generatorEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {};
  if (environment['PATH'] !== undefined) allowed['PATH'] = environment['PATH'];
  if (environment['NODE_ENV'] !== undefined) allowed['NODE_ENV'] = environment['NODE_ENV'];
  return allowed;
}

export class CliGeneratorRunner implements GeneratorRunner {
  constructor(
    private readonly options: Pick<
      AppConfig,
      'generatorCliPath' | 'generatorTimeoutMs' | 'generatorMaxOutputBytes'
    >,
    private readonly spawnProcess: SpawnProcess = (command, args, options) =>
      spawn(command, args, options),
  ) {}

  async run(
    rawInput: GeneratorInput,
    onProgress: (progress: GeneratorProgress) => Promise<void> | void,
  ): Promise<AgentManifest> {
    const input = generatorInputSchema.parse(rawInput);
    const workDirectory = await mkdtemp(path.join(tmpdir(), 'agent-builder-generator-'));
    const inputPath = path.join(workDirectory, 'input.json');
    const outputPath = path.join(workDirectory, 'manifest.json');

    try {
      await writeFile(inputPath, JSON.stringify(input), { encoding: 'utf8', mode: 0o600 });
      let bytesSeen = 0;
      let stdoutBuffer = '';
      let stderr = '';
      let progressChain = Promise.resolve();

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const child = this.spawnProcess(
          process.execPath,
          [this.options.generatorCliPath, '--input', inputPath, '--output', outputPath],
          {
            cwd: workDirectory,
            env: generatorEnvironment(process.env),
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        );
        const stdout = child.stdout;
        const stderrStream = child.stderr;
        if (stdout === null || stderrStream === null) {
          child.kill();
          reject(
            new GeneratorRunnerError(
              'GENERATOR_SPAWN_FAILED',
              'Generator process did not provide piped output streams',
            ),
          );
          return;
        }

        const finish = (error?: Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve();
        };

        const consumeLine = (line: string): void => {
          if (line.trim() === '') return;
          try {
            const progress = generatorProgressSchema.parse(JSON.parse(line));
            progressChain = progressChain.then(() => onProgress(progress));
          } catch (error: unknown) {
            child.kill();
            finish(
              new GeneratorRunnerError(
                'MALFORMED_PROGRESS',
                `Generator emitted invalid progress: ${errorMessage(error)}`,
              ),
            );
          }
        };

        const timer = setTimeout(() => {
          child.kill();
          finish(
            new GeneratorRunnerError(
              'GENERATOR_TIMEOUT',
              `Generator exceeded ${this.options.generatorTimeoutMs}ms`,
            ),
          );
        }, this.options.generatorTimeoutMs);
        timer.unref();

        stdout.on('data', (chunk: Buffer) => {
          bytesSeen += chunk.length;
          if (bytesSeen > this.options.generatorMaxOutputBytes) {
            child.kill();
            finish(
              new GeneratorRunnerError(
                'GENERATOR_OUTPUT_LIMIT',
                'Generator exceeded the configured output limit',
              ),
            );
            return;
          }
          stdoutBuffer += chunk.toString('utf8');
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() ?? '';
          lines.forEach(consumeLine);
        });

        stderrStream.on('data', (chunk: Buffer) => {
          bytesSeen += chunk.length;
          stderr = `${stderr}${chunk.toString('utf8')}`.slice(
            -this.options.generatorMaxOutputBytes,
          );
          if (bytesSeen > this.options.generatorMaxOutputBytes) {
            child.kill();
            finish(
              new GeneratorRunnerError(
                'GENERATOR_OUTPUT_LIMIT',
                'Generator exceeded the configured output limit',
              ),
            );
          }
        });

        child.once('error', (error) => {
          finish(
            new GeneratorRunnerError(
              'GENERATOR_SPAWN_FAILED',
              `Could not start generator: ${error.message}`,
            ),
          );
        });
        child.once('close', (code, signal) => {
          consumeLine(stdoutBuffer);
          if (settled) return;
          if (code !== 0) {
            finish(
              new GeneratorRunnerError(
                'GENERATOR_EXITED',
                `Generator exited with code ${String(code)} and signal ${String(signal)}${
                  stderr ? `: ${stderr}` : ''
                }`,
              ),
            );
            return;
          }
          finish();
        });
      });

      await progressChain;
      const manifestText = await readFile(outputPath, 'utf8').catch((error: unknown) => {
        throw new GeneratorRunnerError(
          'GENERATOR_OUTPUT_MISSING',
          `Generator did not produce a manifest: ${errorMessage(error)}`,
        );
      });
      try {
        return agentManifestSchema.parse(JSON.parse(manifestText));
      } catch (error: unknown) {
        throw new GeneratorRunnerError(
          'GENERATOR_OUTPUT_INVALID',
          `Generator manifest failed validation: ${errorMessage(error)}`,
        );
      }
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
}
