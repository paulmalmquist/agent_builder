import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  agentManifestSchema,
  generatorInputSchema,
  generatorProgressSchema,
  type AgentManifest,
  type GeneratorProgress,
} from '@agent-builder/contracts';
import { composeManifest } from './generator.js';

const MAX_INPUT_BYTES = 1_000_000;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface CliOptions {
  inputPath: string;
  outputPath: string;
}

export function parseArguments(argv: readonly string[]): CliOptions {
  const inputIndex = argv.indexOf('--input');
  const outputIndex = argv.indexOf('--output');
  const inputPath = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
  const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;

  if (!inputPath || !outputPath) {
    throw new Error('Usage: --input <spec.json> --output <manifest.json>');
  }

  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  if (resolvedInput === resolvedOutput) {
    throw new Error('Input and output paths must be different');
  }

  return { inputPath: resolvedInput, outputPath: resolvedOutput };
}

function emit(io: CliIo, progress: number, message: string): void {
  const event: GeneratorProgress = generatorProgressSchema.parse({
    type: 'progress',
    progress,
    message,
  });
  io.stdout(JSON.stringify(event));
}

export async function executeCli(
  options: CliOptions,
  io: CliIo,
  generatedAt = new Date(),
): Promise<AgentManifest> {
  emit(io, 10, 'Validating governed agent specification');
  const inputStats = await stat(options.inputPath);
  if (!inputStats.isFile() || inputStats.size > MAX_INPUT_BYTES) {
    throw new Error(`Input must be a JSON file smaller than ${MAX_INPUT_BYTES} bytes`);
  }

  const rawText = await readFile(options.inputPath, 'utf8');
  const rawInput: unknown = JSON.parse(rawText);
  const input = generatorInputSchema.parse(rawInput);

  emit(io, 35, 'Composing workflow and knowledge bindings');
  const manifest = composeManifest(input, generatedAt);

  emit(io, 70, 'Materializing guardrails and evaluation contract');
  agentManifestSchema.parse(manifest);

  await mkdir(dirname(options.outputPath), { recursive: true });
  const temporaryPath = `${options.outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, options.outputPath);

  emit(io, 100, 'Agent manifest generated');
  return manifest;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  try {
    const options = parseArguments(argv);
    await executeCli(options, io);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown generator failure';
    io.stderr(JSON.stringify({ type: 'error', code: 'GENERATOR_FAILED', message }));
    return 1;
  }
}
