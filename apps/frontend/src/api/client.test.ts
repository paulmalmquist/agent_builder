import { http, HttpResponse } from 'msw';
import { agentApi, platformApi } from './client';
import { server } from '../test/server';

describe('contract-parsed API client', () => {
  it('parses the current request session through the shared identity contract', async () => {
    await expect(platformApi.getSession()).resolves.toMatchObject({
      principal: {
        actorId: 'test-operator',
        workspaceId: '42424242-4242-4242-8242-424242424242',
        authentication: 'local',
      },
      effectiveRoles: ['consumer', 'builder', 'owner', 'admin'],
      authorizationModel: 'workspace-role-v1',
    });
  });

  it('loads one exact governed resource version for stable Knowledge deep links', async () => {
    await expect(
      platformApi.getResource('12121212-1212-4121-8121-121212121212'),
    ).resolves.toMatchObject({
      id: '12121212-1212-4121-8121-121212121212',
      name: 'Daily Brief',
      version: '1.0.0',
    });
  });

  it('fails loudly when a successful response drifts from the shared schema', async () => {
    server.use(
      http.get('http://localhost/agents', () =>
        HttpResponse.json({ query: '', items: [{ id: 'not-an-agent' }] }),
      ),
    );

    await expect(agentApi.search('')).rejects.toMatchObject({
      code: 'CONTRACT_MISMATCH',
    });
  });

  it('preserves typed API errors', async () => {
    server.use(
      http.get('http://localhost/agents', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'Catalog unavailable',
              requestId: 'request-123',
            },
          },
          { status: 503 },
        ),
      ),
    );

    await expect(agentApi.search('')).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      status: 503,
      requestId: 'request-123',
    });
  });

  it('bounds a stalled Attention request with a typed timeout error', async () => {
    vi.useFakeTimers();
    server.use(
      http.get('http://localhost/v1/attention', () => new Promise<never>(() => undefined)),
    );

    try {
      const expectation = expect(platformApi.getAttention()).rejects.toMatchObject({
        code: 'REQUEST_TIMEOUT',
        status: 408,
        message: 'The review queue took too long to respond.',
      });
      await vi.advanceTimersByTimeAsync(8_000);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });
});
