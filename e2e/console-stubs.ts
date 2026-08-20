import type { Page } from '@playwright/test';
import { roadmapProgramFixture } from '../apps/frontend/src/test/roadmap-fixture.js';

const now = '2026-08-17T12:00:00.000Z';
const attentionApprovalGroupKey = 'a'.repeat(64);

const emptyLifecycleCounts = {
  experimental: 0,
  candidate: 0,
  evaluating: 0,
  evaluated: 0,
  certified: 0,
  production: 0,
  deprecated: 0,
};

const emptyRunStateCounts = {
  awaiting_approval: 0,
  queued: 0,
  running: 0,
  paused_budget: 0,
  paused_plugin: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

const attentionItem = {
  id: `execution_approval:${attentionApprovalGroupKey}`,
  kind: 'execution_approval',
  shelf: 'decide',
  headline: 'Daily Briefing wants authority for one run.',
  delta: 'Calendar read access · up to $0.40 per run',
  status: 'decide',
  primaryAction: {
    kind: 'approve_run',
    label: 'Review and approve',
    consequence: 'Allows only matching work inside these limits.',
    undo: 'Revoke the grant to stop later matching work.',
    resourceId: attentionApprovalGroupKey,
    requiresRationale: true,
  },
  secondaryAction: {
    kind: 'reject_run',
    label: 'Reject request',
    consequence: 'Cancels this run and records your reason.',
    undo: 'Create a new request after its limits change.',
    resourceId: attentionApprovalGroupKey,
    requiresRationale: true,
  },
  cost: { period: 'run', usd: 0.4, budgetUsd: 0.5 },
  reason: 'The first run of a promoted release needs a human decision.',
  provenance: {
    sourceType: 'ApprovalRequest',
    sourceId: '27272727-2727-4272-8272-272727272727',
    actorId: 'local-user',
    requestId: null,
    explanation: 'No matching authority grant exists for this exact release.',
  },
  occurredAt: now,
  payload: {
    sourceType: 'ApprovalRequest',
    sourceId: '27272727-2727-4272-8272-272727272727',
    detailPath: '/operate',
    scopes: ['Calendar — read only'],
    runId: '14141414-1414-4141-8141-141414141414',
    candidateId: null,
    channelKey: null,
    releaseId: '16161616-1616-4161-8161-161616161616',
    evaluationId: null,
    expiresAt: null,
    approvalGroupKey: attentionApprovalGroupKey,
    requestCount: 1,
    subject: { name: 'Daily Briefing', kind: 'agent', version: '1.0.0' },
    reviewFacts: [
      { label: 'Release', value: 'Daily Briefing production release' },
      { label: 'Authority', value: 'Calendar — read only' },
    ],
    metadata: {},
  },
};

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

export interface ConsoleStubOptions {
  attention?: 'empty' | 'one-decision';
}

export interface ConsoleStubTelemetry {
  unexpectedRequests: string[];
}

/**
 * Stubs only the read contracts exercised by the console shell. Unknown API calls fail closed and
 * are returned to the test as telemetry so a new surface cannot silently inherit `{items: []}`.
 */
export async function stubConsoleReadModels(
  page: Page,
  options: ConsoleStubOptions = {},
): Promise<ConsoleStubTelemetry> {
  const unexpectedRequests: string[] = [];
  const includeDecision = options.attention !== 'empty';

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      unexpectedRequests.push(`${request.method()} ${path}`);
      await route.fulfill(
        json(
          {
            error: {
              code: 'E2E_STUB_MISSING',
              message: `No E2E stub for ${request.method()} ${path}`,
            },
          },
          501,
        ),
      );
      return;
    }

    if (path === '/v1/attention') {
      await route.fulfill(
        json({
          generatedAt: now,
          decide: includeDecision ? [attentionItem] : [],
          degraded: [],
          digest: {
            headline: includeDecision
              ? '2 runs · $0.40 · 0 promotions since the last briefing'
              : 'No new platform activity',
            runCount: includeDecision ? 2 : 0,
            totalCostUsd: includeDecision ? 0.4 : 0,
            promotionCount: 0,
            observationCount: 0,
            windowStartedAt: null,
            windowEndedAt: now,
          },
          decideBadgeCount: includeDecision ? 1 : 0,
          lastDeliveredBriefingAt: includeDecision ? null : '2026-08-17T11:00:00.000Z',
        }),
      );
      return;
    }

    if (path.startsWith('/v1/production-channels/')) {
      await route.fulfill(json(null));
      return;
    }

    const readResponses: Record<string, object> = {
      '/v1/session': {
        principal: {
          principalId: '41414141-4141-4141-8141-414141414141',
          actorId: 'e2e-operator',
          workspaceId: '42424242-4242-4242-8242-424242424242',
          departmentId: '43434343-4343-4343-8343-434343434343',
          authentication: 'local',
          roles: ['admin'],
          requestId: 'e2e-request',
        },
        effectiveRoles: ['consumer', 'builder', 'owner', 'admin'],
        permissions: [
          'catalog:read',
          'runs:execute',
          'builder:author',
          'evidence:review',
          'release:govern',
          'platform:administer',
        ],
        authorizationModel: 'workspace-role-v1',
      },
      '/v1/resources': { items: [], total: 0, countsByLifecycle: emptyLifecycleCounts },
      '/v1/roadmaps': roadmapProgramFixture,
      '/v1/catalog/publications': { items: [] },
      '/v1/plugins': { items: [] },
      '/v1/plugin-installations': { items: [] },
      '/v1/execution-runs': { items: [], total: 0, countsByState: emptyRunStateCounts },
      '/v1/authority-grants': { items: [], total: 0, activeTotal: 0 },
      '/v1/automation-schedules': { items: [], total: 0, activeTotal: 0 },
      '/v1/outcomes': { items: [] },
      '/v1/metrics': { items: [] },
      '/v1/observations': { items: [] },
      '/v1/improvement-candidates': { items: [] },
      '/v1/memory-candidates': { items: [] },
    };
    const response = readResponses[path];
    if (response) {
      await route.fulfill(json(response));
      return;
    }

    unexpectedRequests.push(`GET ${path}`);
    await route.fulfill(
      json({ error: { code: 'E2E_STUB_MISSING', message: `No E2E stub for GET ${path}` } }, 501),
    );
  });

  await page.route('**/agents*', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === '/agents') {
      await route.fulfill(json({ mode: 'catalog', query: '', items: [], nextCursor: null }));
      return;
    }
    unexpectedRequests.push(`${request.method()} ${path}`);
    await route.fulfill(
      json(
        {
          error: {
            code: 'E2E_STUB_MISSING',
            message: `No E2E stub for ${request.method()} ${path}`,
          },
        },
        501,
      ),
    );
  });

  return { unexpectedRequests };
}
