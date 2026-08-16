import { http, HttpResponse } from 'msw';
import { agentApi } from './client';
import { server } from '../test/server';

describe('contract-parsed API client', () => {
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
});
