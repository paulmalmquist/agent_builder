import { readFile } from 'node:fs/promises';

const baseUrl = process.env.PAUL_OS_BASE_URL ?? 'http://127.0.0.1:8080';
const smokeId = crypto.randomUUID();
const dailyBriefManifestUrl = new URL('../02-skills/daily-brief/manifest.yaml', import.meta.url);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  if (response.status !== expectedStatus) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function exactResource(kind, slug) {
  const response = await requestJson(
    `/v1/resources?kind=${encodeURIComponent(kind)}&query=${encodeURIComponent(slug)}&limit=20`,
  );
  const matches = response.items.filter((item) => item.kind === kind && item.slug === slug);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${kind} resource named ${slug}; found ${matches.length}`);
  }
  return matches[0];
}

async function pollRun(runId, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let run;
  while (Date.now() < deadline) {
    run = await requestJson(`/v1/execution-runs/${runId}`);
    if (['succeeded', 'failed', 'cancelled', 'paused_budget'].includes(run.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(run?.state === 'succeeded', `${label} did not succeed: ${JSON.stringify(run)}`);
  return run;
}

async function findScheduledRun(signal, timeoutMs = 35_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runs = await requestJson('/v1/execution-runs?limit=100');
    const match = runs.items.find(
      (run) => Array.isArray(run.input.signals) && run.input.signals.includes(signal),
    );
    if (match !== undefined) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The persisted scheduler did not create a run for ${signal}`);
}

async function assertOutcomeAndMetrics(runId, label) {
  const outcomes = await requestJson(`/v1/outcomes?runId=${runId}`);
  const metrics = await requestJson(`/v1/metrics?runId=${runId}`);
  assert(outcomes.items.length === 1, `${label} did not persist exactly one outcome`);
  const requiredMetrics = [
    'model.input_tokens',
    'model.output_tokens',
    'model.cost',
    'run.latency',
    'outcome.quality',
  ];
  for (const requiredMetric of requiredMetrics) {
    assert(
      metrics.items.some((metric) => metric.name === requiredMetric),
      `${label} did not persist ${requiredMetric}`,
    );
  }
  return { outcome: outcomes.items[0], metrics: metrics.items };
}

// A synthetic signal is recorded as a provenance-bearing observation. There is intentionally
// no separate mutable Signal resource: signal identity and evidence enter through Observation.
const initialObservation = await requestJson(
  '/v1/observations',
  {
    method: 'POST',
    body: JSON.stringify({
      signalKey: `compose-planning-signal-${smokeId}`,
      signalType: 'repeated_planning_friction',
      summary: 'Synthetic planning inputs need a concise, governed daily briefing.',
      evidence: { fixture: 'compose_lifecycle', occurrenceCount: 3 },
      provenance: { source: 'synthetic_acceptance', smokeId },
      sourceRunId: null,
      sourceOutcomeId: null,
    }),
  },
  201,
);
const incubatorCandidate = await requestJson(
  '/v1/improvement-candidates',
  {
    method: 'POST',
    body: JSON.stringify({
      observationId: initialObservation.id,
      title: 'Produce a governed daily planning brief',
      proposedTarget: 'Skill:daily-brief@1.0.0',
      proposedChange: 'Compile planning inputs into a cited, bounded daily briefing outcome.',
      evidenceRefs: [`observation:${initialObservation.id}`],
    }),
  },
  201,
);
const incubatingCandidate = await requestJson(
  `/v1/improvement-candidates/${incubatorCandidate.id}/review`,
  {
    method: 'POST',
    body: JSON.stringify({
      decision: 'incubate',
      rationale: 'Accept the synthetic observation as the governed Compose lifecycle fixture.',
    }),
  },
  200,
);
assert(incubatingCandidate.state === 'incubating', 'The initial candidate was not incubated');

// Exercise the real compiler/import boundary. The seed provides exact dependency pins, so this
// frozen candidate import is idempotent while still proving the HTTP contract used by Git content.
const manifestYaml = await readFile(dailyBriefManifestUrl, 'utf8');
const imported = await requestJson(
  '/v1/repository-imports',
  {
    method: 'POST',
    body: JSON.stringify({
      manifestYaml,
      sourcePath: '02-skills/daily-brief/manifest.yaml',
      improvementCandidateId: incubatingCandidate.id,
    }),
  },
  201,
);
assert(imported.resource.slug === 'daily-brief', 'The compiled skill import returned another slug');
assert(imported.resource.lifecycle === 'candidate', 'The imported skill is not a candidate');
assert(
  imported.import.improvementCandidateId === incubatingCandidate.id,
  'The imported skill did not retain its reviewed improvement-candidate lineage',
);

const skill = imported.resource;
const suite = await exactResource('EvaluationSuite', 'daily-brief-contract');
const reference = await exactResource('Reference', 'briefing-principles');
const release = await requestJson(
  '/v1/releases',
  {
    method: 'POST',
    body: JSON.stringify({
      resourceVersionIds: [reference.id, skill.id, suite.id],
      projectId: null,
    }),
  },
  201,
);
const evaluation = await requestJson(
  '/v1/release-evaluations',
  {
    method: 'POST',
    body: JSON.stringify({ releaseId: release.id, suiteVersionId: suite.id }),
  },
  201,
);
assert(evaluation.verdict === 'passed', 'Release contract evaluation did not pass');
assert(
  evaluation.executorKind === 'deterministic_contract' &&
    evaluation.evaluationMode === 'contract_validation',
  'Release evidence was not stamped with the deterministic contract executor',
);
assert(
  evaluation.disclaimer.includes('does not measure semantic model quality'),
  'Release evidence omitted the fixture-quality disclaimer',
);
const [certifiedSkill, certifiedSuite, certifiedReference] = await Promise.all([
  exactResource('Skill', 'daily-brief'),
  exactResource('EvaluationSuite', 'daily-brief-contract'),
  exactResource('Reference', 'briefing-principles'),
]);
assert(certifiedSkill.lifecycle === 'certified', 'Passing evidence did not certify the skill');
assert(certifiedSuite.lifecycle === 'certified', 'Passing evidence did not certify its suite');
assert(
  certifiedReference.lifecycle === 'certified',
  'Passing evidence did not certify the subject dependency closure',
);

const promotion = await requestJson(
  '/v1/production-channels/default/promote',
  {
    method: 'POST',
    body: JSON.stringify({
      releaseId: release.id,
      evaluationId: evaluation.id,
      rationale: 'Promote the synthetic Compose smoke release with immutable test evidence.',
    }),
  },
  200,
);
assert(promotion.channel.currentReleaseId === release.id, 'Promotion did not swap the channel');
assert(promotion.decision.action === 'promoted', 'Promotion evidence recorded another action');

const firstInput = {
  date: '2026-08-16',
  timezone: 'UTC',
  priorities: ['Verify the external worker path'],
  calendarItems: [],
  tasks: ['Persist a deterministic outcome'],
  signals: [`first-production-run-${smokeId}`],
  userConstraints: [],
};
const firstRun = await requestJson(
  '/v1/execution-runs',
  {
    method: 'POST',
    body: JSON.stringify({
      releaseId: release.id,
      authorityGrantId: null,
      input: firstInput,
      maxInputTokens: 2000,
      maxOutputTokens: 1000,
      maxEstimatedCostUsd: 1,
      idempotencyKey: `compose-first-${smokeId}`,
      developmentDraft: false,
    }),
  },
  202,
);
assert(
  firstRun.state === 'awaiting_approval',
  `The first promoted run must await human approval; received ${firstRun.state}`,
);

const approval = await requestJson(
  `/v1/execution-runs/${firstRun.id}/approve`,
  {
    method: 'POST',
    body: JSON.stringify({
      projectId: null,
      inputConstraints: { date: '2026-08-16', timezone: 'UTC' },
      toolScopes: [],
      validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      maxRuns: 2,
      maxEstimatedCostPerRunUsd: 1,
      totalCostBudgetUsd: 2,
      rationale: 'Approve the exact synthetic release and bounded smoke-test input envelope.',
    }),
  },
  200,
);
assert(approval.run.state === 'queued', 'Approved first production run was not queued');

await pollRun(firstRun.id, 'The human-approved first production run');
await assertOutcomeAndMetrics(firstRun.id, 'The human-approved first production run');

// The second run is created by the persisted schedule and must reuse the bounded grant without a
// second approval. A unique input signal lets this remain deterministic if the autonomous clock
// wins the race with the explicit schedule-due nudge used to keep CI fast.
const scheduledSignal = `scheduled-unattended-run-${smokeId}`;
const scheduledInput = {
  ...firstInput,
  priorities: ['Verify bounded unattended automation'],
  tasks: ['Persist a scheduled deterministic outcome'],
  signals: [scheduledSignal],
};
const schedule = await requestJson(
  '/v1/automation-schedules',
  {
    method: 'POST',
    body: JSON.stringify({
      name: `Compose daily brief ${smokeId}`,
      channelKey: 'default',
      releaseId: release.id,
      authorityGrantId: approval.grant.id,
      timezone: 'UTC',
      intervalSeconds: 86_400,
      nextRunAt: new Date(Date.now() - 1000).toISOString(),
      inputTemplate: scheduledInput,
      inputConstraints: { date: '2026-08-16', timezone: 'UTC' },
      catchUpPolicy: 'latest_only',
      maxCatchUpRuns: 1,
      deduplicationWindowSeconds: 300,
      retry: { maximumAttempts: 2, backoff: 'fixed' },
      cost: { maxInputTokens: 2000, maxOutputTokens: 1000, maxEstimatedCostUsd: 1 },
      outcomeExpectations: { validatedDailyBrief: true },
    }),
  },
  201,
);
const scheduleResult = await requestJson('/v1/automation-schedules/schedule-due', {
  method: 'POST',
  body: JSON.stringify({ now: new Date().toISOString(), limit: 25 }),
});
assert(scheduleResult.awaitingApproval === 0, 'The scheduled run requested a second approval');
assert(scheduleResult.failedDispatches === 0, 'The persisted schedule produced a failed dispatch');

const scheduledRun = await findScheduledRun(scheduledSignal);
assert(
  scheduledRun.state !== 'awaiting_approval',
  'A matching authority envelope did not permit unattended scheduled execution',
);
await requestJson(`/v1/automation-schedules/${schedule.id}/state`, {
  method: 'POST',
  body: JSON.stringify({
    state: 'paused',
    rationale: 'Pause the one-shot Compose acceptance schedule after its persisted dispatch.',
  }),
});
const completedScheduledRun = await pollRun(
  scheduledRun.id,
  'The unattended scheduled production run',
);
assert(
  completedScheduledRun.authorityGrantId === approval.grant.id,
  'The scheduled run did not retain the approved authority lineage',
);
const scheduledEvidence = await assertOutcomeAndMetrics(
  scheduledRun.id,
  'The unattended scheduled production run',
);

// Close the loop: measurement-backed work becomes a reviewable observation and candidate. Durable
// memory is only staged; it is never silently accepted by the runtime.
const outcomeObservation = await requestJson(
  '/v1/observations',
  {
    method: 'POST',
    body: JSON.stringify({
      signalKey: `compose-outcome-signal-${smokeId}`,
      signalType: 'measured_outcome_learning',
      summary: 'The scheduled briefing completed with persisted quality, usage, and cost evidence.',
      evidence: {
        metricNames: scheduledEvidence.metrics.map((metric) => metric.name),
        qualityScore: scheduledEvidence.outcome.qualityScore,
      },
      provenance: { source: 'synthetic_outcome', releaseDigest: release.digest },
      sourceRunId: scheduledRun.id,
      sourceOutcomeId: scheduledEvidence.outcome.id,
    }),
  },
  201,
);
const learningCandidate = await requestJson(
  '/v1/improvement-candidates',
  {
    method: 'POST',
    body: JSON.stringify({
      observationId: outcomeObservation.id,
      title: 'Review measured daily-brief evidence',
      proposedTarget: 'daily-brief@next',
      proposedChange: 'Review the measured outcome before proposing a successor skill version.',
      evidenceRefs: [
        `run:${scheduledRun.id}`,
        `outcome:${scheduledEvidence.outcome.id}`,
        `observation:${outcomeObservation.id}`,
      ],
    }),
  },
  201,
);
assert(learningCandidate.state === 'proposed', 'Learning bypassed human candidate review');

const memoryCandidate = await requestJson(
  '/v1/memory-candidates',
  {
    method: 'POST',
    body: JSON.stringify({
      sourceRunId: scheduledRun.id,
      namespace: 'daily-brief.synthetic-preferences',
      proposedValue: { preferredOrder: ['priorities', 'risks', 'decisions'] },
      provenance: {
        outcomeId: scheduledEvidence.outcome.id,
        observationId: outcomeObservation.id,
      },
    }),
  },
  201,
);
assert(memoryCandidate.state === 'staged', 'Durable memory was accepted without human review');

const [observations, proposedCandidates, stagedMemory] = await Promise.all([
  requestJson(`/v1/observations?sourceRunId=${scheduledRun.id}&limit=20`),
  requestJson('/v1/improvement-candidates?state=proposed&limit=100'),
  requestJson(`/v1/memory-candidates?sourceRunId=${scheduledRun.id}&limit=20`),
]);
assert(
  observations.items.some((item) => item.id === outcomeObservation.id),
  'Outcome observation was not queryable by run lineage',
);
assert(
  proposedCandidates.items.some((item) => item.id === learningCandidate.id),
  'Measured learning candidate was not preserved for curation',
);
assert(
  stagedMemory.items.some((item) => item.id === memoryCandidate.id && item.state === 'staged'),
  'Staged memory was not queryable by run lineage',
);

console.log(
  [
    'Compose lifecycle smoke passed',
    `release=${release.id}`,
    `approvedRun=${firstRun.id}`,
    `scheduledRun=${scheduledRun.id}`,
    `learningCandidate=${learningCandidate.id}`,
  ].join(' '),
);
