import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenApiDocument } from '../../../packages/contracts/dist/openapi.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const brokerDirectory = resolve(scriptDirectory, '..');
const output = resolve(brokerDirectory, 'openapi', 'paul-os.openapi.json');
const fullDocument = createOpenApiDocument();
const selectedPaths = ['/live', '/ready', '/v1/session'];
const paths = Object.fromEntries(
  selectedPaths.map((path) => {
    const value = fullDocument.paths?.[path];
    if (!value) throw new Error(`Required OpenAPI path ${path} is missing`);
    return [path, value];
  }),
);
const document = { ...fullDocument, paths };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Wrote broker OpenAPI input: ${output}`);
