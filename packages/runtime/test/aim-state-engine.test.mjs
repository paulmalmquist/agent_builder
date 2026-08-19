import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  AimManifestValidationError,
  StaticAimManifestAdapter,
  diffProgramState,
  loadAimProgram,
  loadAimProgramFile,
  loadAimProgramOrThrow,
  normalizeAimProgram,
  serializeAimProgram,
  stateAt,
} from '../dist/aim/index.js';

const seedPath = new URL('../../../03-projects/aim/program.seed.json', import.meta.url);
const seedText = await readFile(seedPath, 'utf8');
const seed = loadAimProgramOrThrow(seedText);
const at = (timestamp) => stateAt(seed, timestamp);
const part = (state, id) => state.parts.find((item) => item.id === id);
const metric = (state, id) => state.metrics.find((item) => item.id === id);

test('loader is bounded, strict, deterministic, and safe for browser consumption', () => {
  const loaded = loadAimProgram(seedText);
  assert.equal(loaded.ok, true);
  assert.equal(loadAimProgram('{bad json').issues[0].code, 'invalid_json');
  assert.equal(loadAimProgram(seedText, { maxBytes: 10 }).issues[0].code, 'manifest_too_large');
  assert.equal(loadAimProgram(seed, { maxBytes: 10 }).issues[0].code, 'manifest_too_large');
  assert.equal(loadAimProgram(seed, { maxBytes: 0 }).issues[0].code, 'invalid_loader_option');
  assert.equal(
    loadAimProgram(JSON.parse('{"__proto__":{"polluted":true}}')).issues[0].code,
    'forbidden_key',
  );

  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(loadAimProgram(cyclic).issues[0].code, 'cyclic_input');
  let deeplyNested = {};
  for (let depth = 0; depth < 110; depth += 1) deeplyNested = { nested: deeplyNested };
  assert.equal(loadAimProgram(deeplyNested).issues[0].code, 'manifest_too_deep');
  assert.throws(() => loadAimProgramOrThrow('{}'), AimManifestValidationError);

  const original = structuredClone(seed);
  const normalized = normalizeAimProgram(seed);
  assert.deepEqual(seed, original);
  assert.equal(serializeAimProgram(normalized), serializeAimProgram(seed));
  assert.deepEqual(
    normalized.parts.map(({ id }) => id),
    [...normalized.parts.map(({ id }) => id)].sort(),
  );
});

test('fixed dates derive every lifecycle material without duplicating visual facts', () => {
  assert.equal(part(at('2026-08-10T00:00:00Z'), 's1_thrust').lifecycle, 'planned');
  assert.equal(part(at('2026-08-10T00:00:00Z'), 's1_thrust').visual.material, 'wireframe');
  assert.equal(part(at('2026-08-20T00:00:00Z'), 's1_thrust').visual.material, 'additive_reveal');
  assert.equal(part(at('2026-09-20T00:00:00Z'), 's1_thrust').visual.material, 'scaffold');
  assert.equal(part(at('2026-11-16T00:00:00Z'), 's1_thrust').visual.material, 'solid');
  assert.equal(part(at('2026-11-16T00:00:00Z'), 'gantries').visual.material, 'ghost');
  assert.equal(part(at('2026-11-16T00:00:00Z'), 'gantries').visual.dimmed, true);
});

test('metric history drives tank fill, print speed, agent heartbeat, and decision latency', () => {
  const state = at('2026-09-17T00:00:00Z');
  assert.equal(metric(state, 'knowledge_coverage').value, 63);
  assert.equal(part(state, 's1_fuel_tank').visual.tankFill, 0.63);
  assert.equal(state.factory.maturityPercent, 50);
  assert.equal(state.factory.printSpeed, 1);
  assert.equal(state.decisionLoops[0].baselineLatencyHours, 120);
  assert.equal(state.decisionLoops[0].currentLatencyHours, 48);
  assert.equal(part(state, 'avionics_bay').visual.heartbeatActive, true);

  const activated = at('2026-11-16T00:00:00Z');
  assert.equal(part(activated, 'avionics_bay').qualifyingAgentActive, true);
  assert.equal(activated.decisionLoops[0].currentLatencyHours, 16);
});

test('literal hardware, primary ownership, manufacturing process, and agent coverage project directly', () => {
  const state = at('2026-08-17T12:00:00Z');
  assert.deepEqual(
    state.groups.filter(({ kind }) => kind === 'primary').map(({ label }) => label),
    [
      'Structures',
      'Propulsion',
      'Factory operations',
      'Integration and test',
      'Quality',
      'Avionics and safety',
    ],
  );
  assert.deepEqual(state.groupCoverage.groupsWithoutCertifiedAgentIds, [
    'group_quality',
    'group_avionics',
  ]);
  assert.equal(state.groupCoverage.primaryGroupCount, 6);

  const tank = part(state, 's1_lox_tank');
  assert.equal(tank.label, 'Stage 1 oxidizer tank');
  assert.equal(tank.makeMethod, 'printed');
  assert.equal(tank.ownerGroupId, 'group_factory');
  assert.match(tank.process, /Wire additive/);
  assert.equal(tank.coverage.agentCount, 3);
  assert.equal(tank.coverage.certifiedAgentCount, 2);
  assert.equal(tank.coverage.evidenceFreshnessHours, 60);

  const hotFire = state.agents.find(({ id }) => id === 'agent_hot_fire_quicklook');
  assert.equal(hotFire.tier, 2);
  assert.equal(hotFire.certificationStatus, 'certified');
  assert.equal(hotFire.certificationEvidenceFresh, true);
  assert.equal(hotFire.synthetic, true);
  assert.deepEqual(
    hotFire.connectors.map(({ label }) => label),
    ['Test historian', 'Analytics warehouse'],
  );
  assert.ok(hotFire.connectors.every(({ accent }) => /^#[0-9A-F]{6}$/i.test(accent)));
});

test('validated workstreams project declared dates with resolved source provenance', () => {
  const state = at('2026-08-17T12:00:00Z');
  assert.equal(state.workstreams.length, 10);
  assert.deepEqual(
    state.workstreams
      .filter(({ ownerGroupId }) => ownerGroupId === 'group_factory')
      .map(({ id }) => id),
    ['workstream_print_cell_qualification', 'workstream_tank_barrel_production'],
  );
  assert.deepEqual(
    state.workstreams.find(({ id }) => id === 'workstream_print_cell_qualification'),
    {
      id: 'workstream_print_cell_qualification',
      label: 'Print cell qualification',
      ownerGroupId: 'group_factory',
      affectedPartIds: ['stargate'],
      startAt: '2026-08-01T00:00:00Z',
      endAt: '2026-08-15T00:00:00Z',
      state: 'complete',
      sourceRefs: ['synthetic_program_plan'],
      milestoneIds: ['milestone_foundation_gate'],
      sourceSynthetic: true,
    },
  );
  assert.ok(
    state.workstreams.every((workstream) =>
      workstream.sourceRefs.every(
        (sourceId) => seed.sources.find(({ id }) => id === sourceId)?.synthetic === true,
      ),
    ),
  );
});

test('workstreams appear only when every declared source is observable and usable', () => {
  assert.equal(at('2026-08-14T23:59:59Z').workstreams.length, 0);
  assert.equal(at('2026-08-15T00:00:00Z').workstreams.length, 10);

  const multipleSources = structuredClone(seed);
  multipleSources.workstreams[0].sourceRefs.push('synthetic_evidence_registry');
  assert.equal(
    stateAt(multipleSources, '2026-08-15T00:00:00Z').workstreams.some(
      ({ id }) => id === multipleSources.workstreams[0].id,
    ),
    false,
  );
  assert.equal(
    stateAt(multipleSources, '2026-08-16T00:00:00Z').workstreams.some(
      ({ id }) => id === multipleSources.workstreams[0].id,
    ),
    true,
  );

  const missing = structuredClone(seed);
  missing.sources = missing.sources.filter(({ id }) => id !== 'synthetic_program_plan');
  assert.equal(stateAt(missing, '2026-08-17T12:00:00Z').workstreams.length, 0);

  const conflicting = structuredClone(seed);
  conflicting.sources.find(({ id }) => id === 'synthetic_program_plan').reconciliationStatus =
    'conflicting';
  assert.equal(stateAt(conflicting, '2026-08-17T12:00:00Z').workstreams.length, 0);

  const stale = structuredClone(seed);
  stale.sources.find(({ id }) => id === 'synthetic_program_plan').freshnessSlaHours = 60;
  assert.equal(stateAt(stale, '2026-08-17T12:00:00Z').workstreams.length, 10);
  assert.equal(stateAt(stale, '2026-08-17T12:00:01Z').workstreams.length, 0);
});

test('workstream sourceSynthetic resolves from any referenced source, not the program flag', () => {
  const declaredLive = structuredClone(seed);
  declaredLive.sources.find(({ id }) => id === 'synthetic_program_plan').synthetic = false;
  assert.ok(
    stateAt(declaredLive, '2026-08-17T12:00:00Z').workstreams.every(
      ({ sourceSynthetic }) => !sourceSynthetic,
    ),
  );

  const mixed = structuredClone(declaredLive);
  mixed.workstreams[0].sourceRefs.push('synthetic_evidence_registry');
  assert.equal(
    stateAt(mixed, '2026-08-17T12:00:00Z').workstreams.find(
      ({ id }) => id === mixed.workstreams[0].id,
    ).sourceSynthetic,
    true,
  );
});

test('certification coverage fails closed when its synthetic evidence becomes stale', () => {
  const state = at('2027-08-18T12:00:00Z');
  assert.ok(
    state.agents
      .filter(({ certificationStatus }) => certificationStatus === 'certified')
      .every(({ certificationEvidenceFresh }) => !certificationEvidenceFresh),
  );
  assert.deepEqual(
    state.groupCoverage.groupsWithoutCertifiedAgentIds,
    state.groups.filter(({ kind }) => kind === 'primary').map(({ id }) => id),
  );
});

test('non-synthetic programs do not count synthetic placeholder agents as current coverage', () => {
  const mixed = structuredClone(seed);
  mixed.program.synthetic = false;

  const placeholdersOnly = stateAt(mixed, '2026-08-17T12:00:00Z');
  assert.deepEqual(
    placeholdersOnly.groupCoverage.groupsWithoutCertifiedAgentIds,
    placeholdersOnly.groups.filter(({ kind }) => kind === 'primary').map(({ id }) => id),
  );
  assert.equal(part(placeholdersOnly, 's1_thrust').coverage.certifiedAgentCount, 0);

  const transferredAgent = mixed.agents.find(({ id }) => id === 'agent_as_built_reconciliation');
  transferredAgent.synthetic = false;
  const syntheticFlagOnly = stateAt(mixed, '2026-08-17T12:00:00Z');
  assert.equal(
    syntheticFlagOnly.groups.find(({ id }) => id === 'group_structures').hasCertifiedAgent,
    false,
  );

  mixed.sources.push({
    id: 'work_transfer_source',
    label: 'Governed work transfer',
    kind: 'manual',
    adapterVersion: '1.0.0',
    observedAt: '2026-08-17T10:00:00Z',
    freshnessSlaHours: 168,
    classification: 'internal',
    synthetic: false,
    reconciliationStatus: 'authoritative',
  });
  mixed.evidence.push({
    id: 'ev_work_transfer_certification',
    label: 'Governed work transfer certification',
    type: 'approval',
    sourceId: 'work_transfer_source',
    observedAt: '2026-08-17T10:00:00Z',
    freshnessSlaHours: 168,
  });
  transferredAgent.sourceRefs = ['work_transfer_source'];
  transferredAgent.certificationEvidenceRefs = ['ev_work_transfer_certification'];
  const oneGovernedAgent = stateAt(mixed, '2026-08-17T12:00:00Z');
  assert.equal(
    oneGovernedAgent.groups.find(({ id }) => id === 'group_structures').hasCertifiedAgent,
    true,
  );
  assert.equal(part(oneGovernedAgent, 's1_thrust').coverage.certifiedAgentCount, 1);
});

test('production lifecycle remains source truth while missing evidence blocks GO presentation', () => {
  const beforeEvidence = part(at('2026-10-16T00:00:00Z'), 's1_thrust');
  assert.equal(beforeEvidence.lifecycle, 'production');
  assert.equal(beforeEvidence.visual.material, 'solid');
  assert.equal(beforeEvidence.sourceReadiness, 'go');
  assert.equal(beforeEvidence.evidenceGate.mayRenderGo, false);
  assert.equal(beforeEvidence.evidenceGate.warning, true);
  assert.equal(beforeEvidence.visual.readinessTreatment, 'evidence_warning');

  const afterEvidence = part(at('2026-11-16T00:00:00Z'), 's1_thrust');
  assert.equal(afterEvidence.evidenceGate.status, 'satisfied');
  assert.equal(afterEvidence.evidenceGate.mayRenderGo, true);
  assert.equal(afterEvidence.visual.readinessTreatment, 'green_confirmation');
});

test('GO with no declared evidence, stale evidence, conflicts, and missing metrics fail visibly', () => {
  const noEvidence = structuredClone(seed);
  const noEvidencePart = noEvidence.parts.find(({ id }) => id === 'range_safety');
  noEvidencePart.evidenceRefs = [];
  noEvidencePart.statusHistory[0].evidenceRefs = [];
  assert.equal(
    part(stateAt(noEvidence, '2026-08-17T00:00:00Z'), 'range_safety').evidenceGate.status,
    'evidence_missing',
  );

  const stale = structuredClone(seed);
  stale.evidence.find(({ id }) => id === 'ev_seed_contract').freshnessSlaHours = 1;
  assert.equal(
    part(stateAt(stale, '2026-08-17T00:00:00Z'), 'range_safety').evidenceGate.status,
    'evidence_stale',
  );

  const conflicting = structuredClone(seed);
  conflicting.sources.find(({ id }) => id === 'synthetic_program_plan').reconciliationStatus =
    'conflicting';
  assert.equal(
    part(stateAt(conflicting, '2026-08-17T00:00:00Z'), 'range_safety').evidenceGate.status,
    'source_conflict',
  );

  const missingMetrics = structuredClone(seed);
  const metricBoundPart = missingMetrics.parts.find(({ id }) => id === 's1_engines');
  metricBoundPart.statusHistory[0].readiness = 'go';
  metricBoundPart.statusHistory[0].evidenceRefs = ['ev_seed_contract'];
  missingMetrics.metrics.find(
    ({ id }) => id === 'decision_latency_current',
  ).observations[0].observedAt = '2027-01-01T00:00:00Z';
  assert.equal(
    part(stateAt(missingMetrics, '2026-08-17T00:00:00Z'), 's1_engines').evidenceGate.status,
    'metrics_missing',
  );
});

test('metric staleness honors the observation source SLA before the display default', () => {
  const value = structuredClone(seed);
  value.displayPolicy.defaultEvidenceFreshnessSlaHours = 8760;
  value.sources.find(({ id }) => id === 'synthetic_metric_registry').freshnessSlaHours = 1;
  assert.equal(metric(stateAt(value, '2026-08-17T00:00:00Z'), 'factory_maturity').isStale, true);
});

test('decision-step cycling is demonstrative only for explicitly synthetic manifests', () => {
  const syntheticState = at('2026-11-16T00:00:00Z');
  assert.equal(syntheticState.decisionLoops[0].syntheticAnimation, true);
  assert.notEqual(syntheticState.decisionLoops[0].activeStepId, null);

  const real = structuredClone(seed);
  real.program.synthetic = false;
  const realState = stateAt(real, '2026-08-17T00:00:00Z');
  assert.equal(realState.decisionLoops[0].syntheticAnimation, false);
  assert.equal(realState.decisionLoops[0].activeStepId, null);
  assert.equal(part(realState, 'avionics_bay').visual.heartbeatActive, false);
});

test('stateAt is pure, reports timeline bounds, and rejects invalid selected time', () => {
  const original = structuredClone(seed);
  assert.equal(at('2026-07-01T00:00:00Z').outsideTimeline, true);
  assert.equal(at('2026-08-17T00:00:00Z').outsideTimeline, false);
  assert.throws(() => stateAt(seed, 'not-a-date'), RangeError);
  assert.deepEqual(seed, original);
});

test('QBR diff reports printed, promoted, retired, evidence, coverage, agents, latency, and seams', () => {
  const diff = diffProgramState(at('2026-08-10T00:00:00Z'), at('2026-11-16T00:00:00Z'));
  assert.ok(diff.newlyPrintedPartIds.includes('s1_thrust'));
  assert.ok(diff.productionPromotionPartIds.includes('s1_thrust'));
  assert.ok(diff.retiredPartIds.includes('gantries'));
  assert.ok(diff.newEvidenceIds.includes('ev_production_gate'));
  assert.ok(
    diff.knowledgeCoverageChanges.some(
      ({ partId, delta }) => partId === 's1_fuel_tank' && delta === 65,
    ),
  );
  assert.ok(diff.activatedAgentPartIds.includes('avionics_bay'));
  assert.ok(diff.newlyCertifiedAgentIds.includes('agent_hot_fire_quicklook'));
  assert.deepEqual(diff.decisionLatencyChanges[0], {
    decisionLoopId: 'loop_primary_decision',
    beforeHours: 120,
    afterHours: 16,
    reductionHours: 104,
  });
  assert.ok(diff.newlyGovernedInterfaceIds.includes('seam_s1_thrust_s1_fuel_tank'));
});

test('Level 0 and local-text Level 1 adapters are offline and explain failures', async () => {
  assert.equal(new StaticAimManifestAdapter(seedText).load().ok, true);
  assert.equal(
    (await loadAimProgramFile({ name: 'program.yaml', size: 2, text: async () => '{}' })).issues[0]
      .code,
    'unsupported_file_type',
  );
  assert.equal(
    (
      await loadAimProgramFile({
        name: 'program.json',
        size: 2_000_001,
        text: async () => seedText,
      })
    ).issues[0].code,
    'manifest_too_large',
  );
  assert.equal(
    (
      await loadAimProgramFile(
        { name: 'program.json', size: 0, text: async () => '{}' },
        { maxBytes: 0 },
      )
    ).issues[0].code,
    'invalid_loader_option',
  );
  assert.equal(
    (
      await loadAimProgramFile({
        name: 'program.json',
        size: -1,
        text: async () => '{}',
      })
    ).issues[0].code,
    'invalid_file_size',
  );
  assert.equal(
    (
      await loadAimProgramFile({
        name: 'program.json',
        size: 10,
        text: async () => {
          throw new Error('private path');
        },
      })
    ).issues[0].code,
    'file_read_failed',
  );
  assert.equal(
    (
      await loadAimProgramFile({
        name: 'program.json',
        size: seedText.length,
        text: async () => seedText,
      })
    ).ok,
    true,
  );
});
