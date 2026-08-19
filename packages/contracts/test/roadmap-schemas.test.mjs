import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { roadmapProgramSchema } from '../dist/index.js';

const seedUrl = new URL('../../../03-projects/roadmaps/roadmaps.seed.json', import.meta.url);

async function loadSeed() {
  return JSON.parse(await readFile(seedUrl, 'utf8'));
}

test('the transfer seed defines exactly two honest roadmap forks', async () => {
  const parsed = roadmapProgramSchema.parse(await loadSeed());

  assert.equal(parsed.schemaVersion, 'roadmaps.program/v1');
  assert.equal(parsed.forks.length, 2);
  assert.equal(parsed.synthetic, true);
  assert.ok(parsed.forks.every((fork) => fork.jira.state === 'awaiting_transfer'));
  assert.ok(parsed.forks.every((fork) => fork.metrics.every((metric) => metric.source !== 'live')));
});

test('awaiting-transfer metrics cannot masquerade as measurements', async () => {
  const seed = await loadSeed();
  seed.forks[0].metrics[0] = {
    ...seed.forks[0].metrics[0],
    source: 'awaiting_transfer',
    value: '82%',
  };

  const parsed = roadmapProgramSchema.safeParse(seed);
  assert.equal(parsed.success, false);
});

test('synthetic programs cannot emit live roadmap metrics', async () => {
  const seed = await loadSeed();
  seed.forks[1].metrics[0].source = 'live';

  const parsed = roadmapProgramSchema.safeParse(seed);
  assert.equal(parsed.success, false);
});

test('live roadmap state requires a complete live Jira binding', async () => {
  const seed = await loadSeed();
  seed.synthetic = false;
  seed.forks[0].metrics[0].source = 'live';

  assert.equal(roadmapProgramSchema.safeParse(seed).success, false);

  seed.forks[0].jira = {
    state: 'live',
    projectKey: 'FORK1',
    filterId: null,
    includedIssueCount: 84,
    totalIssueCount: 100,
    lastSyncedAt: '2026-08-19T12:00:00Z',
  };
  assert.equal(roadmapProgramSchema.safeParse(seed).success, true);
});

test('an absent Jira population cannot claim on-track or carry private binding IDs', async () => {
  const seed = await loadSeed();
  seed.forks[0].status = 'on_track';
  assert.equal(roadmapProgramSchema.safeParse(seed).success, false);

  seed.forks[0].status = 'watch';
  seed.forks[0].jira.projectKey = 'PRIVATE';
  assert.equal(roadmapProgramSchema.safeParse(seed).success, false);
});

test('configured bindings cannot present stale issue counts as a live population', async () => {
  const seed = await loadSeed();
  seed.synthetic = false;
  seed.forks[0].jira = {
    state: 'configured',
    projectKey: 'FORK1',
    filterId: null,
    includedIssueCount: 80,
    totalIssueCount: 100,
    lastSyncedAt: '2026-08-19T12:00:00Z',
  };

  assert.equal(roadmapProgramSchema.safeParse(seed).success, false);
});
