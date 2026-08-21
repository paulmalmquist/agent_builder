import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputPath, declaredCommit = ''] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: write-build-metadata.mjs <output-path> [commit]');

const commit = declaredCommit.trim();
if (commit !== '' && !/^[a-f0-9]{7,64}$/i.test(commit)) {
  throw new Error('The declared build commit must be a hexadecimal Git commit ID');
}

const metadata = {
  commit: commit === '' ? null : commit,
  buildTimestamp: new Date().toISOString(),
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(metadata)}\n`, 'utf8');
