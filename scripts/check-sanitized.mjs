import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = process.cwd();
const joined = (...parts) => parts.join('');
const ignoredDirectoryNames = new Set([
  '.git',
  '.local',
  '.runtime',
  '.test-dist',
  'coverage',
  'dist',
  'node_modules',
]);
const immutableAllowlistPrefixes = ['apps/backend/prisma/migrations/20260731000000_init/'];
const neutralizingMigrationLines = new Map([
  [
    'apps/backend/prisma/migrations/20260816000000_paul_os_vertical_slice/migration.sql',
    new RegExp(
      `^ALTER TYPE "SourceProvider" RENAME VALUE '${joined('inter', 'stellar')}' TO 'telemetry';$`,
      'i',
    ),
  ],
]);
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.prisma',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);
const extensionlessTextFiles = new Set(['Dockerfile']);

const prohibited = [
  { label: 'legacy employer brand', expression: new RegExp(joined('rela', 'tivity'), 'i') },
  { label: 'legacy internal connector', expression: new RegExp(joined('inter', 'stellar'), 'i') },
  {
    label: 'legacy manufacturing-system abbreviation',
    expression: new RegExp(String.raw`\b${joined('M', 'ES')}\b`, 'i'),
  },
  {
    label: 'legacy cloud-project identifier',
    expression: new RegExp(joined('no', 'vendor-events-prod'), 'i'),
  },
];

function portablePath(filePath) {
  return path.relative(repositoryRoot, filePath).split(path.sep).join('/');
}

function isAllowlisted(relativePath) {
  return immutableAllowlistPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function isNeutralizingMigrationLine(relativePath, line) {
  return neutralizingMigrationLines.get(relativePath)?.test(line.trim()) ?? false;
}

async function collectTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        files.push(...(await collectTextFiles(absolutePath)));
      }
      continue;
    }
    if (!entry.isFile()) continue;

    const extension = path.extname(entry.name).toLowerCase();
    if (textExtensions.has(extension) || extensionlessTextFiles.has(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files;
}

const violations = [];
for (const filePath of await collectTextFiles(repositoryRoot)) {
  const relativePath = portablePath(filePath);
  if (isAllowlisted(relativePath)) continue;

  const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (isNeutralizingMigrationLine(relativePath, line)) return;
    prohibited.forEach(({ label, expression }) => {
      if (expression.test(line)) {
        violations.push(`${relativePath}:${index + 1} ${label}`);
      }
    });
  });
}

if (violations.length > 0) {
  console.error('Sanitization check failed:');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
} else {
  console.log(
    'Sanitization check passed. Active content contains no prohibited legacy identifiers.',
  );
}
