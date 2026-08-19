import assert from 'node:assert/strict';
import test from 'node:test';
import { attentionMembershipSchema } from '../dist/attention-schemas.js';

const record = (index) => ({
  label: `Authority request 0${index}`,
  subject: { name: 'Daily Brief', kind: 'agent', version: '1.0.0' },
  occurredAt: `2026-08-18T10:0${index}:00.000Z`,
  evidence: [
    {
      label: 'Decision match',
      value: 'Exact authority, input, retry, and cost requirements match this group.',
    },
  ],
  technicalReferences: [
    {
      label: 'Approval request',
      value: `10000000-0000-4000-8000-00000000000${index}`,
    },
  ],
});

test('attention detail membership binds its exact count to inspectable records', () => {
  const parsed = attentionMembershipSchema.parse({
    exactCount: 2,
    records: [record(1), record(2)],
  });
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].subject.name, 'Daily Brief');

  assert.equal(
    attentionMembershipSchema.safeParse({ exactCount: 3, records: [record(1), record(2)] }).success,
    false,
  );
  assert.equal(
    attentionMembershipSchema.safeParse({
      exactCount: 1,
      records: [
        {
          ...record(1),
          technicalReferences: [{ label: 'Approval request', value: 'opaque-reference' }],
        },
      ],
    }).success,
    false,
  );
});
