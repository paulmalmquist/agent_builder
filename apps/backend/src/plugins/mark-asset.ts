import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pluginResourceSpecSchema } from '@agent-builder/contracts';
import { compileResourceYaml } from '@paul-os/runtime';
import { SaxesParser } from 'saxes';
import { AppError } from '../errors.js';

const CONTENT_ROOT = /^\d{2}-[a-z0-9-]+$/u;
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const MAX_MANIFEST_BYTES = 1_000_000;
export const MAX_PLUGIN_MARK_BYTES = 128 * 1024;

const allowedElements = new Set([
  'circle',
  'clipPath',
  'defs',
  'desc',
  'ellipse',
  'g',
  'line',
  'linearGradient',
  'mask',
  'path',
  'polygon',
  'polyline',
  'radialGradient',
  'rect',
  'stop',
  'svg',
  'title',
]);

const allowedAttributes = new Set([
  'aria-hidden',
  'aria-label',
  'clip-path',
  'clip-rule',
  'cx',
  'cy',
  'd',
  'fill',
  'fill-opacity',
  'fill-rule',
  'focusable',
  'fr',
  'fx',
  'fy',
  'gradientTransform',
  'gradientUnits',
  'height',
  'id',
  'mask',
  'offset',
  'opacity',
  'pathLength',
  'points',
  'preserveAspectRatio',
  'r',
  'role',
  'rx',
  'ry',
  'spreadMethod',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'transform',
  'vector-effect',
  'version',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'y',
  'y1',
  'y2',
]);

function unavailable(): AppError {
  return new AppError(404, 'PLUGIN_MARK_NOT_FOUND', 'The Plugin mark was not found');
}

function fail(): never {
  throw unavailable();
}

function relativeSegments(value: string, allowDotPrefix: boolean): string[] {
  if (
    value.length === 0 ||
    value.length > 500 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
  ) {
    return fail();
  }
  const normalized = allowDotPrefix && value.startsWith('./') ? value.slice(2) : value;
  const segments = normalized.split('/');
  if (
    segments.length === 0 ||
    segments.some(
      (segment) =>
        segment === '' || segment === '.' || segment === '..' || !PATH_SEGMENT.test(segment),
    )
  ) {
    return fail();
  }
  return segments;
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..') fail();
  if (path.isAbsolute(relative)) fail();
}

async function assertNoSymlinkSegments(
  repositoryRoot: string,
  segments: readonly string[],
): Promise<{ absolutePath: string; size: number }> {
  let current = repositoryRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await lstat(current);
    } catch {
      return fail();
    }
    if (stat.isSymbolicLink()) fail();
    const isFinal = index === segments.length - 1;
    if ((!isFinal && !stat.isDirectory()) || (isFinal && !stat.isFile())) fail();
  }
  const resolved = await realpath(current).catch(fail);
  assertWithinRoot(repositoryRoot, resolved);
  return { absolutePath: resolved, size: (await lstat(resolved)).size };
}

function safeReferenceValue(value: string): boolean {
  if (value.length > 32_768) return false;
  if (/\b(?:data|file|https?|javascript|vbscript):|\/\/|@import/iu.test(value)) return false;
  const references = value.match(/url\s*\([^)]*\)/giu) ?? [];
  return references.every((reference) =>
    /^url\s*\(\s*#[A-Za-z][A-Za-z0-9_.:-]*\s*\)$/u.test(reference),
  );
}

/**
 * Validate a deliberately small, passive SVG profile. The original bytes are returned only when
 * every element and attribute is understood; this is rejection, not best-effort sanitization.
 */
export function assertPassivePluginSvg(svg: string): void {
  let rootSeen = false;
  let elementCount = 0;
  const stack: string[] = [];
  const parser = new SaxesParser({ xmlns: true, fragment: false });

  parser.on('error', fail);
  parser.on('doctype', fail);
  parser.on('processinginstruction', fail);
  parser.on('comment', fail);
  parser.on('cdata', fail);
  parser.on('xmldecl', (declaration) => {
    if (
      (declaration.version !== undefined && declaration.version !== '1.0') ||
      (declaration.encoding !== undefined && declaration.encoding.toLowerCase() !== 'utf-8')
    ) {
      fail();
    }
  });
  parser.on('text', (text) => {
    if (text.trim().length === 0) return;
    const parent = stack.at(-1);
    if (parent !== 'title' && parent !== 'desc') fail();
  });
  parser.on('opentag', (tag) => {
    elementCount += 1;
    if (elementCount > 1_024 || stack.length > 64) fail();
    if (tag.prefix !== '' || tag.uri !== SVG_NAMESPACE || !allowedElements.has(tag.local)) fail();
    if (!rootSeen) {
      if (tag.local !== 'svg') fail();
      rootSeen = true;
    } else if (stack.length === 0) {
      fail();
    }
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.prefix === 'xmlns') fail();
      if (attribute.name === 'xmlns') {
        if (attribute.value !== SVG_NAMESPACE || stack.length !== 0) fail();
        continue;
      }
      if (
        attribute.prefix !== '' ||
        /^on/iu.test(attribute.local) ||
        attribute.local === 'style' ||
        attribute.local === 'href' ||
        !allowedAttributes.has(attribute.local) ||
        !safeReferenceValue(attribute.value)
      ) {
        fail();
      }
      if (attribute.local === 'role' && attribute.value !== 'img') fail();
      if (attribute.local === 'clip-path' || attribute.local === 'mask') {
        if (!/^url\(#[A-Za-z][A-Za-z0-9_.:-]*\)$/u.test(attribute.value)) fail();
      }
    }
    stack.push(tag.local);
  });
  parser.on('closetag', () => {
    stack.pop();
  });

  try {
    parser.write(svg).close();
  } catch {
    fail();
  }
  if (!rootSeen || stack.length !== 0) fail();
}

export interface PluginMarkAsset {
  bytes: Buffer;
  digest: string;
}

export async function loadPluginMarkAsset(input: {
  expectedManifestDigest: string;
  markPath: string;
  repositoryRoot: string;
  sourcePath: string;
}): Promise<PluginMarkAsset> {
  let configuredRoot;
  try {
    const rootStat = await lstat(input.repositoryRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail();
    configuredRoot = await realpath(input.repositoryRoot);
  } catch {
    return fail();
  }

  const sourceSegments = relativeSegments(input.sourcePath, false);
  if (!CONTENT_ROOT.test(sourceSegments[0] ?? '') || sourceSegments.at(-1) !== 'manifest.yaml') {
    fail();
  }
  const markSegments = relativeSegments(input.markPath, true);
  if (markSegments.at(-1)?.toLowerCase().endsWith('.svg') !== true) fail();
  const markSourceSegments = [...sourceSegments.slice(0, -1), ...markSegments];

  const sourceFile = await assertNoSymlinkSegments(configuredRoot, sourceSegments);
  const markFile = await assertNoSymlinkSegments(configuredRoot, markSourceSegments);
  if (
    sourceFile.size <= 0 ||
    sourceFile.size > MAX_MANIFEST_BYTES ||
    markFile.size <= 0 ||
    markFile.size > MAX_PLUGIN_MARK_BYTES
  ) {
    fail();
  }

  const [manifestBytes, markBytes] = await Promise.all([
    readFile(sourceFile.absolutePath),
    readFile(markFile.absolutePath),
  ]);
  // Re-check after reading so a symlink swap cannot turn a validated pathname into a served file.
  await assertNoSymlinkSegments(configuredRoot, sourceSegments);
  await assertNoSymlinkSegments(configuredRoot, markSourceSegments);

  let manifestYaml: string;
  let svg: string;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    manifestYaml = decoder.decode(manifestBytes);
    svg = decoder.decode(markBytes);
  } catch {
    return fail();
  }
  try {
    const compiled = compileResourceYaml(manifestYaml);
    if (compiled.digest !== input.expectedManifestDigest || compiled.manifest.kind !== 'Plugin') {
      fail();
    }
    if (pluginResourceSpecSchema.parse(compiled.manifest.spec).brand?.mark !== input.markPath) {
      fail();
    }
    assertPassivePluginSvg(svg);
  } catch {
    fail();
  }

  return {
    bytes: markBytes,
    digest: createHash('sha256').update(markBytes).digest('hex'),
  };
}
