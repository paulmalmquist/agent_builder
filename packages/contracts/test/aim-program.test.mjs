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
  assert.ok(
    result.data.parts.every(
      (part) => part.label === result.data.anchors.find(({ id }) => id === part.anchorId)?.label,
    ),
  );
  assert.ok(
    result.data.parts.every((part) =>
      ['printed', 'purchased', 'facility'].includes(part.makeMethod),
    ),
  );
  assert.ok(result.data.parts.every((part) => part.process.length >= 10));
  assert.ok(result.data.agents.every((agent) => agent.synthetic));
  assert.ok(result.data.agents.every((agent) => agent.description.startsWith('Synthetic ')));
  assert.equal(result.data.workstreams.length, 10);
  assert.ok(
    result.data.workstreams.every((workstream) =>
      workstream.sourceRefs.every(
        (sourceId) => result.data.sources.find(({ id }) => id === sourceId)?.synthetic === true,
      ),
    ),
  );
  assert.deepEqual(
    result.data.workstreams
      .filter(({ ownerGroupId }) => ownerGroupId === 'group_factory')
      .map(({ id }) => id),
    ['workstream_print_cell_qualification', 'workstream_tank_barrel_production'],
  );
  const evidenceById = new Map(result.data.evidence.map((item) => [item.id, item]));
  assert.ok(
    result.data.agents
      .filter(({ certificationStatus }) => certificationStatus === 'certified')
      .every(({ certificationEvidenceRefs }) =>
        certificationEvidenceRefs.every((id) => {
          const item = evidenceById.get(id);
          return (
            item?.label.startsWith('Synthetic certification fixture') && item.type === 'approval'
          );
        }),
      ),
  );
  assert.ok(
    result.data.agents
      .flatMap((agent) => agent.connectors)
      .every(
        (connector) =>
          /^#[0-9A-Fa-f]{6}$/.test(connector.accent) &&
          !/infor|bigquery|jira|google|microsoft/i.test(connector.label),
      ),
  );
});

test('six ordered hardware groups own every part exactly once and expose two coverage gaps', async () => {
  const value = aimProgramManifestSchema.parse(await seed());
  const primary = value.groups
    .filter(({ kind }) => kind === 'primary')
    .sort((left, right) => left.displayOrder - right.displayOrder);
  assert.deepEqual(
    primary.map(({ label }) => label),
    [
      'Structures',
      'Propulsion',
      'Factory operations',
      'Integration and test',
      'Quality',
      'Avionics and safety',
    ],
  );
  assert.deepEqual(
    primary.map(({ displayOrder }) => displayOrder),
    [1, 2, 3, 4, 5, 6],
  );
  assert.ok(
    value.groups
      .filter(({ kind }) => kind === 'supporting')
      .every((group) => group.ownedAnchorIds.length === 0),
  );

  for (const part of value.parts) {
    const owners = value.groups.filter((group) => group.ownedAnchorIds.includes(part.anchorId));
    assert.deepEqual(
      owners.map(({ id }) => id),
      [part.ownerGroupId],
    );
    assert.equal(owners[0].kind, 'primary');
    assert.ok(part.participatingGroupIds.includes(part.ownerGroupId));
  }

  const withoutCertified = primary.filter(
    (group) =>
      !value.agents.some(
        (agent) => agent.groupIds.includes(group.id) && agent.certificationStatus === 'certified',
      ),
  );
  assert.deepEqual(
    withoutCertified.map(({ id }) => id),
    ['group_quality', 'group_avionics'],
  );
});

test('schema versions and unknown fields fail closed', async () => {
  const value = await seed();
  assert.equal(
    aimProgramManifestSchema.safeParse({ ...value, schemaVersion: 'aim.program/v1' }).success,
    false,
  );
  assert.equal(
    aimProgramManifestSchema.safeParse({ ...value, visualMaterial: 'solid' }).success,
    false,
  );

  const localMark = clone(value);
  localMark.agents[0].connectors[0].assetSrc = `/v1/plugins/11111111-1111-4111-8111-111111111111/mark/${'a'.repeat(64)}.svg`;
  assert.equal(aimProgramManifestSchema.safeParse(localMark).success, true);

  const remoteMark = clone(value);
  remoteMark.agents[0].connectors[0].assetSrc = 'https://example.test/vendor.svg';
  assert.equal(aimProgramManifestSchema.safeParse(remoteMark).success, false);
});

test('ownership, agent certification, and bidirectional coverage fail closed', async () => {
  const wrongOwner = await seed();
  wrongOwner.parts[0].ownerGroupId = 'group_quality';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(wrongOwner)).some((message) =>
      message.includes('Part anchor must be owned only'),
    ),
  );

  const duplicateOwner = await seed();
  duplicateOwner.groups.find(({ id }) => id === 'group_quality').ownedAnchorIds.push('s1_engines');
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(duplicateOwner)).some((message) =>
      message.includes('Part anchor must be owned only'),
    ),
  );

  const duplicatePartAnchor = await seed();
  duplicatePartAnchor.parts[1].anchorId = duplicatePartAnchor.parts[0].anchorId;
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(duplicatePartAnchor)).some((message) =>
      message.includes('Duplicate hardware part anchor'),
    ),
  );

  const noEvidence = await seed();
  noEvidence.agents.find(
    ({ certificationStatus }) => certificationStatus === 'certified',
  ).certificationEvidenceRefs = [];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(noEvidence)).some((message) =>
      message.includes('Certified agents require certification evidence'),
    ),
  );

  const wrongEvidenceType = await seed();
  wrongEvidenceType.agents.find(
    ({ certificationStatus }) => certificationStatus === 'certified',
  ).certificationEvidenceRefs = ['ev_seed_contract'];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(wrongEvidenceType)).some((message) =>
      message.includes('must be an approval, deployment, or test'),
    ),
  );

  const mismatchedCoverage = await seed();
  mismatchedCoverage.parts.find(({ id }) => id === 's1_engines').coverage.agentIds = [];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(mismatchedCoverage)).some((message) =>
      message.includes('does not declare agent'),
    ),
  );

  const mismatchedGroup = await seed();
  mismatchedGroup.agents.find(({ id }) => id === 'agent_hot_fire_quicklook').groupIds = [
    'group_structures',
  ];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(mismatchedGroup)).some((message) =>
      message.includes('must include owner group'),
    ),
  );

  const unrelatedGroup = await seed();
  unrelatedGroup.agents
    .find(({ id }) => id === 'agent_hot_fire_quicklook')
    .groupIds.push('group_quality');
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(unrelatedGroup)).some((message) =>
      message.includes('has no covered part involving group'),
    ),
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

test('workstream dates, ownership, provenance, and graph references fail closed', async () => {
  const duplicate = await seed();
  duplicate.workstreams.push(clone(duplicate.workstreams[0]));
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(duplicate)).some((message) =>
      message.includes('Duplicate workstreams ID'),
    ),
  );

  const referenceCases = [
    ['ownerGroupId', 'missing_group', 'Unknown group'],
    ['affectedPartIds', ['missing_part'], 'Unknown part'],
    ['sourceRefs', ['missing_source'], 'Unknown source'],
    ['milestoneIds', ['missing_milestone'], 'Unknown milestone'],
  ];
  for (const [field, value, expected] of referenceCases) {
    const manifest = await seed();
    manifest.workstreams[0][field] = value;
    assert.ok(
      messages(aimProgramManifestSchema.safeParse(manifest)).some((message) =>
        message.includes(expected),
      ),
    );
  }

  const wrongOwner = await seed();
  wrongOwner.workstreams[0].ownerGroupId = 'group_quality';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(wrongOwner)).some((message) =>
      message.includes('must be owned by group_quality'),
    ),
  );

  const supportingOwner = await seed();
  supportingOwner.workstreams[0].ownerGroupId = 'group_platform';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(supportingOwner)).some((message) =>
      message.includes('Workstream owner must be a primary'),
    ),
  );

  const noParts = await seed();
  noParts.workstreams[0].affectedPartIds = [];
  assert.equal(aimProgramManifestSchema.safeParse(noParts).success, false);

  const noSources = await seed();
  noSources.workstreams[0].sourceRefs = [];
  assert.equal(aimProgramManifestSchema.safeParse(noSources).success, false);

  const reversed = await seed();
  reversed.workstreams[0].endAt = reversed.workstreams[0].startAt;
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(reversed)).some((message) =>
      message.includes('Workstream endAt must be after startAt'),
    ),
  );

  const beforeTimeline = await seed();
  beforeTimeline.workstreams[0].startAt = '2026-07-31T23:59:59Z';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(beforeTimeline)).some((message) =>
      message.includes('Workstream startAt is outside the timeline'),
    ),
  );

  const afterTimeline = await seed();
  afterTimeline.workstreams[0].endAt = '2027-07-01T00:00:00Z';
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(afterTimeline)).some((message) =>
      message.includes('Workstream endAt is outside the timeline'),
    ),
  );

  const unrelatedMilestone = await seed();
  unrelatedMilestone.workstreams.find(
    ({ id }) => id === 'workstream_tank_barrel_production',
  ).milestoneIds = ['milestone_decision_gate'];
  assert.ok(
    messages(aimProgramManifestSchema.safeParse(unrelatedMilestone)).some((message) =>
      message.includes('must affect a workstream part'),
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
  assert.equal(schema.properties.schemaVersion.const, 'aim.program/v2');
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes('anchors'));
  assert.ok(schema.required.includes('agents'));
  assert.ok(schema.required.includes('workstreams'));
  assert.equal(schema.$defs.part.additionalProperties, false);
  assert.ok(schema.$defs.part.required.includes('makeMethod'));
  assert.ok(schema.$defs.part.required.includes('ownerGroupId'));
  assert.equal(schema.$defs.agent.additionalProperties, false);
  assert.equal(schema.$defs.workstream.additionalProperties, false);
  assert.equal(schema.$defs.workstream.properties.sourceRefs.minItems, 1);
  assert.match(schema.$defs.agentConnector.properties.assetSrc.pattern, /^\^\/v1\/plugins\//);
});
