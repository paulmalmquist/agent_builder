import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  adoptionAggregateSchema,
  platformDistributionSchema,
  starterPackManifestSchema,
} from '../dist/deployment-schemas.js';

const fixtureDirectory = new URL('../../../06-business-domains/synthetic-demo/', import.meta.url);

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, fixtureDirectory), 'utf8'));
}

test('proposal distribution is digest-pinned and synthetic starter data validates', async () => {
  assert.equal(
    platformDistributionSchema.safeParse(await fixture('platform-distribution.seed.json')).success,
    true,
  );
  assert.equal(
    starterPackManifestSchema.safeParse(await fixture('starter-pack.seed.json')).success,
    true,
  );
  assert.equal(
    adoptionAggregateSchema.safeParse(await fixture('adoption-aggregate.seed.json')).success,
    true,
  );
});

test('mutable images and individual productivity fields fail closed', async () => {
  const distribution = await fixture('platform-distribution.seed.json');
  distribution.images.backend = 'registry.example.invalid/paul-os/backend:latest';
  assert.equal(platformDistributionSchema.safeParse(distribution).success, false);

  const aggregate = await fixture('adoption-aggregate.seed.json');
  aggregate.actorId = 'individual@example.invalid';
  assert.equal(adoptionAggregateSchema.safeParse(aggregate).success, false);

  const rankedAggregate = await fixture('adoption-aggregate.seed.json');
  rankedAggregate.containsIndividualRankings = true;
  assert.equal(adoptionAggregateSchema.safeParse(rankedAggregate).success, false);
});

test('starter packs cannot self-approve write or destructive effects', async () => {
  const starterPack = await fixture('starter-pack.seed.json');
  starterPack.defaultAuthorityPolicy.selfApprovableEffects = ['write'];
  assert.equal(starterPackManifestSchema.safeParse(starterPack).success, false);
});
