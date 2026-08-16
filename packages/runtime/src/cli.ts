#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { compileResourceYaml } from './compiler.js';
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
    'Usage: paul-os resource <compile|validate> <manifest> | profile validate <profile> | profile <backup|restore> <input> <output> (requires PAUL_OS_BACKUP_PASSPHRASE)',
  );
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
