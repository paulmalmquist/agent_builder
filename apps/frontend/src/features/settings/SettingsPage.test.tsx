import type { ResourceVersion } from '@agent-builder/contracts';
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsBuildIdentity, SettingsPage } from './SettingsPage';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';

const ids = {
  Protocol: ['51515151-5151-4151-8151-515151515151', '61616161-6161-4161-8161-616161616161'],
  Project: ['52525252-5252-4252-8252-525252525252', '62626262-6262-4262-8262-626262626262'],
  Reference: ['53535353-5353-4353-8353-535353535353', '63636363-6363-4363-8363-636363636363'],
} as const;

function ruleResource(kind: keyof typeof ids): ResourceVersion {
  const [familyId, id] = ids[kind];
  const name =
    kind === 'Protocol'
      ? 'Safe execution'
      : kind === 'Project'
        ? 'Local operations'
        : 'Console copy';
  const slug = name.toLocaleLowerCase().replaceAll(' ', '-');
  return {
    id,
    familyId,
    kind,
    slug,
    name,
    version: '1.0.0',
    owner: 'Local platform owner',
    purpose: `Provide a governed synthetic ${kind.toLocaleLowerCase()} for local verification.`,
    lifecycle: 'candidate',
    digest: 'a'.repeat(64),
    sourceCommit: 'test-commit',
    provenance: 'synthetic-test',
    dependencyPins: [],
    definition: {
      apiVersion: 'paul-os/v1',
      kind,
      metadata: {
        id: familyId,
        slug,
        version: '1.0.0',
        name,
        owner: 'Local platform owner',
        purpose: `Provide a governed synthetic ${kind.toLocaleLowerCase()} for local verification.`,
        lifecycle: 'candidate',
        provenance: 'synthetic-test',
      },
      dependencies: [],
      spec: {},
    },
    revision: 1,
    frozenAt: '2026-08-17T12:00:00.000Z',
    createdAt: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T12:00:00.000Z',
  };
}

function installRuleHandler() {
  server.use(
    http.get('http://localhost/v1/resources', ({ request }) => {
      const kind = new URL(request.url).searchParams.get('kind') as keyof typeof ids | null;
      const item = kind && kind in ids ? ruleResource(kind) : null;
      return HttpResponse.json({
        items: item ? [item] : [],
        total: item ? 1 : 0,
        countsByLifecycle: {
          experimental: 0,
          candidate: item ? 1 : 0,
          evaluating: 0,
          evaluated: 0,
          certified: 0,
          production: 0,
          deprecated: 0,
        },
      });
    }),
  );
}

describe('Settings', () => {
  it('renders the exact declared commit without shortening it', () => {
    const expectedCommit = '0ae2bc333745ac739e21b8e8b7ae223671b5c53c';
    const expectedTimestamp = '2026-08-21T14:30:00.000Z';

    renderWithClient(
      <SettingsBuildIdentity
        build={{ commit: expectedCommit, buildTimestamp: expectedTimestamp }}
        frontendCommit={expectedCommit}
      />,
      ['/settings'],
    );

    expect(screen.getByText('RUNNING BUILD · DECLARED')).toBeInTheDocument();
    expect(screen.getAllByText(expectedCommit)).toHaveLength(3);
    expect(screen.getByText(expectedTimestamp)).toBeVisible();
    expect(screen.getByText('/v1/health')).toBeInTheDocument();
  });

  it('states that build identity is unavailable instead of inferring a revision', () => {
    renderWithClient(
      <SettingsBuildIdentity
        build={{ commit: null, buildTimestamp: null }}
        frontendCommit={null}
      />,
      ['/settings'],
    );

    expect(screen.getByText('BUILD IDENTITY UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED RUNNING COMMIT').parentElement).toHaveTextContent(
      'UNAVAILABLE',
    );
    expect(screen.getByText('API BUILD TIMESTAMP').parentElement).toHaveTextContent('UNAVAILABLE');
    expect(screen.getByText(/does not infer them/i)).toBeInTheDocument();
  });

  it('does not present a single running commit when the frontend and API builds differ', () => {
    renderWithClient(
      <SettingsBuildIdentity
        build={{
          commit: '1111111111111111111111111111111111111111',
          buildTimestamp: '2026-08-21T14:30:00.000Z',
        }}
        frontendCommit="2222222222222222222222222222222222222222"
      />,
      ['/settings'],
    );

    expect(screen.getByText('BUILD IDENTITY MISMATCH')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED RUNNING COMMIT').parentElement).toHaveTextContent(
      'UNAVAILABLE',
    );
    expect(screen.getByText('FRONTEND ASSET COMMIT').parentElement).toHaveTextContent('22222222');
    expect(screen.getByText('API BUILD COMMIT').parentElement).toHaveTextContent('11111111');
  });

  it('shows server-resolved scope and honest control-plane boundaries', async () => {
    const user = userEvent.setup();
    installRuleHandler();
    renderWithClient(<SettingsPage />, ['/settings']);

    expect(await screen.findByText('Local operator')).toBeVisible();
    expect(screen.getByText('Local workspace')).toBeVisible();
    expect(screen.getByText('Local department')).toBeVisible();
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Effective roles' })).toHaveTextContent('admin');
    expect(screen.getByRole('list', { name: 'Granted permissions' })).toHaveTextContent(
      'platform:administer',
    );

    expect(screen.getByRole('heading', { name: 'Project switching' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Access directory' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Repository import history' })).toBeInTheDocument();
    expect(screen.getByText(/does not manufacture a last-import status/i)).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Safe execution' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Local operations' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Console copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    expect(screen.getByText('test-operator')).not.toBeVisible();
    expect(screen.getByText('42424242-4242-4242-8242-424242424242')).not.toBeVisible();
    await user.click(screen.getByText('Technical identifiers'));
    expect(screen.getByText('test-operator')).toBeVisible();
    expect(screen.getByText('42424242-4242-4242-8242-424242424242')).toBeVisible();
    expect(screen.getByText('43434343-4343-4343-8343-434343434343')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Running build identity' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open self-verification/i })).toHaveAttribute(
      'href',
      '/selftest',
    );
  });

  it('fails closed when the current session cannot be resolved', async () => {
    server.use(
      http.get('http://localhost/v1/session', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'Identity ledger unavailable.',
              requestId: 'settings-test',
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderWithClient(<SettingsPage />, ['/settings']);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Current session unavailable. Identity ledger unavailable.',
    );
    expect(screen.queryByText('Local operator')).not.toBeInTheDocument();
    expect(screen.getByText('SESSION UNAVAILABLE')).toBeInTheDocument();
  });
});
