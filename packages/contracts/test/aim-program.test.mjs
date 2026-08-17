import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AIM_GEOMETRY_DISCLAIMER, aimProgramManifestSchema } from '../dist/aim/index.js';
import { aimProgramJsonSchema } from '../dist/aim/schema.js';

const seedPath = new URL('../../../03-projects/aim/program.seed.json', import.meta.url);
const requiredAnchors = [
  's1_engines',
  's1_thrust',
  's1_fuel_tank',
  's1_lox_tank',
  's1_intertank',
  's1_feedlines',
  'interstage',
  's2_engine',
  's2_fuel_tank',
  's2_lox_tank',
  'avionics_bay',
  'fts',
  'payload_adapter',
  'fairing',
  'payload',
  'stargate',
  'gantries',
  'scanner',
  'sensors',
  'test_stand',
  'gse',
  'prop_farm',
  'range_safety',
  'fd_console',
];

async function seed() {
  return JSON.parse(await readFile(seedPath, 'utf8'));
}

function clone(value) {
  return structuredClone(value);
}

function messages(result) {
  return result.success ? [] : result.error.issues.map(({ message }) => message);
}

test('the sanitized seed validates and contains the complete stable anchor cast', async () => {
  const result = aimProgramManifestSchema.safeParse(await seed());
  assert.equal(result.success, true, JSON.stringify(messages(result)));
  assert.equal(result.data.program.synthetic, true);
  assert.equal(result.data.program.geometryDisclaimer, AIM_GEOMETRY_DISCLAIMER);
  assert.deepEqual(
    requiredAnchors.filter((id) => !result.data.anchors.some((anchor) => anchor.id === id)),
    [],
  );
  assert.ok(result.data.parts.every((part) => requiredAnchors.includes(part.anchorId)));
  assert.ok(result.data.sources.every((source) => source.synthetic));
  assert.ok(result.data.sources.every((source) => source.classification === 'public'));
  assert.ok(result.data.evidence.every((item) => item.internalUri === undefined));
});

test('schema versions and unknown fields fail closed', async () => {
  const value = await seed();
  assert.equal(
    aimProgramManifestSchema.safeParse({ ...value, schemaVersion: 'aim.program/v2' }).success,
    false,
  );
  assert.equal(
    aimProgramManifestSchema.safeParse({ ...value, visualMaterial: 'solid' }).success,
    false,
  );
});

test('duplicate IDs and invalid history ordering are rejected', async () => {
  const duplicate = await seed();
  duplicate.parts.push(clone(duplicate.parts[0]));
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(duplicate)).some((message) =>
      message.includes('Duplicate parts ID'),
    ),
  );

  const unordered = await seed();
  unordered.parts.find(({ id }) => id === 's1_thrust').statusHistory.reverse();
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(unordered)).some((message) =>
      message.includes('strictly ordered'),
    ),
  );
});

test('missing group, capability, anchor, source, and generic references are reported', async () => {
  const cases = [
    ['participatingGroupIds', 'missing_group', 'Unknown group'],
    ['capabilityIds', 'missing_capability', 'Unknown capability'],
  ];
  for (const [field, id, expected] of cases) {
    const value = await seed();
    value.parts[0][field] = [id];
    assert.ok(
      messages(aimProgramManifestSchema.safeParse(value)).some((message) =>
        message.includes(expected),
      ),
    );
  }

  const anchor = await seed();
  anchor.parts[0].anchorId = 'missing_anchor';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(anchor)).some((message) =>
      message.includes('Unknown anchor'),
    ),
  );

  const source = await seed();
  source.parts[0].sourceRefs = ['missing_source'];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(source)).some((message) =>
      message.includes('Unknown source'),
    ),
  );

  const evidence = await seed();
  evidence.parts[0].evidenceRefs = ['missing_evidence'];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(evidence)).some((message) =>
      message.includes('Unknown evidence'),
    ),
  );
});

test('dates, fallback regions, aliases, seams, and dependency cycles are governed', async () => {
  const invalidDate = await seed();
  invalidDate.timeline.endAt = 'not-a-date';
  assert.equal(aimProgramManifestSchema.safeParse(invalidDate).success, false);

  const fallback = await seed();
  fallback.parts[0].fallbackRegion = 's1_thrust';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(fallback)).some((message) =>
      message.includes('Fallback anchor must be a region'),
    ),
  );

  const aliases = await seed();
  aliases.anchors[0].aliases = ['s1_thrust'];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(aliases)).some((message) =>
      message.includes('collides with a canonical anchor'),
    ),
  );

  const seam = await seed();
  seam.interfaces[0].id = 'seam_wrong_pair';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(seam)).some((message) =>
      message.includes('Interface ID must be'),
    ),
  );

  const cycle = await seed();
  cycle.capabilities.find(({ id }) => id === 'data_foundation').dependencyIds = [
    'measurable_outcomes',
  ];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(cycle)).some((message) =>
      message.includes('Dependency cycle'),
    ),
  );
});

test('the portable JSON Schema is strict and versioned alongside the runtime contract', async () => {
  const schema = aimProgramJsonSchema;
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, 'aim.program/v1');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('anchors'));
  assert.equal(schema.$defs.part.additionalProperties, false);
});
