#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { consoleCriticalCopyArtifacts } from '@agent-builder/contracts';
import { compileResourceYaml } from './compiler.js';
import { checkGovernedConsoleCopy, evaluateConsoleCopy } from './console-copy.js';
import { decryptProfile, encryptProfile, parseProfileText } from './profile.js';

async function main(arguments_: string[]): Promise<void> {
  const [area, action, inputPath, outputPath] = arguments_;
  if (area === 'resource' && (action === 'compile' || action === 'validate') && inputPath) {
    const compiled = compileResourceYaml(await readFile(inputPath, 'utf8'));
    if (action === 'compile') process.stdout.write(`${JSON.stringify(compiled)}\n`);
    else
      process.stdout.write(`${compiled.manifest.kind} ${compiled.manifest.metadata.slug} valid\n`);
    return;
  }
  if (area === 'profile' && action === 'validate' && inputPath) {
    parseProfileText(await readFile(inputPath, 'utf8'));
    process.stdout.write('Profile valid\n');
    return;
  }
  if (area === 'console-copy' && action === 'generate' && inputPath) {
    await writeFile(
      inputPath,
      `${JSON.stringify(consoleCriticalCopyArtifacts, null, 2)}\n`,
      'utf8',
    );
    process.stdout.write(`Generated governed console copy at ${inputPath}\n`);
    return;
  }
  if (area === 'console-copy' && action === 'check' && inputPath) {
    const governed: unknown = JSON.parse(await readFile(inputPath, 'utf8'));
    const match = checkGovernedConsoleCopy(consoleCriticalCopyArtifacts, governed);
    if (!match.matches) throw new Error(match.reason ?? 'Governed console copy does not match');
    const failures = consoleCriticalCopyArtifacts.flatMap((artifact) => {
      const evaluated = evaluateConsoleCopy(artifact);
      return evaluated.passed
        ? []
        : evaluated.issues.map((issue) => `${artifact.screen}:${issue.path}:${issue.code}`);
    });
    if (failures.length > 0) {
      throw new Error(`Console copy failed deterministic checks: ${failures.join(', ')}`);
    }
    process.stdout.write(`Console copy ${match.canonicalDigest} passed deterministic checks\n`);
    return;
  }
  const passphrase = process.env['PAUL_OS_BACKUP_PASSPHRASE'];
  if (area === 'profile' && action === 'backup' && inputPath && outputPath && passphrase) {
    const profile = parseProfileText(await readFile(inputPath, 'utf8'));
    await writeFile(outputPath, await encryptProfile(profile, passphrase), { mode: 0o600 });
    return;
  }
  if (area === 'profile' && action === 'restore' && inputPath && outputPath && passphrase) {
    const profile = await decryptProfile(await readFile(inputPath, 'utf8'), passphrase);
    await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
    return;
  }
  throw new Error(
    'Usage: paul-os resource <compile|validate> <manifest> | console-copy <generate|check> <governed-json> | profile validate <profile> | profile <backup|restore> <input> <output> (requires PAUL_OS_BACKUP_PASSPHRASE)',
  );
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
