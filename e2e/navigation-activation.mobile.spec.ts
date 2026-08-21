import { expect, test, type Page } from '@playwright/test';
import { roadmapResourceSpecSchema, type ResourceVersion } from '@agent-builder/contracts';
import { stubConsoleReadModels } from './console-stubs.js';

const emptyLifecycleCounts = {
  experimental: 0,
  candidate: 2,
  evaluating: 0,
  evaluated: 0,
  certified: 0,
  production: 0,
  deprecated: 0,
};

function roadmapSearchResource(
  index: number,
  forkId: 'fork_primary' | 'fork_alternate',
): ResourceVersion {
  const familyId = `51000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const resourceVersionId = `52000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  const label = `Roadmap fork 0${index}`;
  const slug = `roadmap-fork-0${index}`;
  const spec = roadmapResourceSpecSchema.parse({
    schemaVersion: 'roadmap.fork/v1',
    program: {
      id: 'two_fork_program',
      title: 'Two-fork program',
      description: 'Two governed transfer slots for independent delivery paths.',
      synthetic: true,
      timeline: {
        startAt: '2026-08-01T00:00:00.000Z',
        endAt: '2027-02-01T00:00:00.000Z',
      },
    },
    fork: {
      id: forkId,
      label,
      purpose: 'Retain an honest roadmap slot until its private Jira binding transfers.',
      status: index === 1 ? 'watch' : 'at_risk',
      jira: {
        state: 'awaiting_transfer',
        projectKey: null,
        filterId: null,
        includedIssueCount: null,
        totalIssueCount: null,
        lastSyncedAt: null,
      },
      metrics: [
        {
          id: `${forkId}_progress`,
          label: 'Representative progress',
          value: `${index * 20}%`,
          detail: 'Synthetic layout value used only by the browser contract.',
          state: index === 1 ? 'watch' : 'at_risk',
          source: 'synthetic',
        },
      ],
      workstreams: [
        {
          id: `${forkId}_workstream`,
          label: `${label} workstream`,
          startAt: '2026-08-01T00:00:00.000Z',
          endAt: '2026-09-01T00:00:00.000Z',
          state: index === 1 ? 'in_work' : 'at_risk',
          source: 'synthetic',
        },
      ],
      actions: [],
    },
    definitionDependencies: [],
    relationships: [],
    relationshipCoverage: {
      vertical: { state: 'unmapped', detail: 'No governed vertical mapping is loaded.' },
      aimGroup: { state: 'unmapped', detail: 'No governed AIM mapping is loaded.' },
      contributingAgents: {
        state: 'unmapped',
        detail: 'No contributing Agent mapping is loaded.',
      },
      executionRuns: { state: 'unavailable', detail: 'No runtime binding is loaded.' },
    },
  });
  const digest = String(index).repeat(64);
  const timestamp = '2026-08-20T12:00:00.000Z';

  return {
    id: resourceVersionId,
    familyId,
    kind: 'Roadmap',
    slug,
    name: label,
    version: '1.0.0',
    owner: 'Program Operations',
    purpose: spec.fork.purpose,
    lifecycle: 'candidate',
    digest,
    sourceCommit: 'navigation-browser-contract',
    provenance: { source: 'synthetic-browser-contract' },
    dependencyPins: [],
    definition: {
      apiVersion: 'paul-os/v1',
      kind: 'Roadmap',
      metadata: {
        id: familyId,
        slug,
        version: '1.0.0',
        name: label,
        owner: 'Program Operations',
        purpose: spec.fork.purpose,
        lifecycle: 'candidate',
        provenance: { source: 'synthetic-browser-contract' },
      },
      dependencies: [],
      spec,
    },
    revision: 1,
    frozenAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function installRoadmapSearch(page: Page): Promise<void> {
  const resources = [
    roadmapSearchResource(1, 'fork_primary'),
    roadmapSearchResource(2, 'fork_alternate'),
  ];
  await page.route('**/v1/resources*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query');
    if (query?.trim().toLocaleLowerCase() !== 'roadmap') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: resources, total: 2, countsByLifecycle: emptyLifecycleCounts }),
    });
  });
}

async function assertNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

test.use({ viewport: { width: 390, height: 844 } });

test('390px search and Today rows activate through real pointer and keyboard paths', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  await installRoadmapSearch(page);
  await page.goto('/');

  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  await assertNoDocumentOverflow(page);

  await page.getByRole('button', { name: 'Search governed entities' }).click();
  const search = page.getByRole('combobox', { name: 'Search governed entities' });
  await search.fill('roadmap');
  const primary = page.getByRole('option', { name: /Roadmap fork 01/i });
  await expect(primary).toHaveAttribute('href', '/roadmaps?fork=fork_primary');
  const primaryBox = await primary.boundingBox();
  expect(primaryBox).not.toBeNull();
  if (primaryBox === null) return;
  await page.mouse.click(primaryBox.x + primaryBox.width / 2, primaryBox.y + primaryBox.height / 2);
  await expect(page).toHaveURL(/\/roadmaps\?fork=fork_primary$/);

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search governed entities' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await search.fill('roadmap');
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp');
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowUp');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(page).toHaveURL(/\/roadmaps\?fork=fork_alternate$/);

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'Factory operations' }).click();
  const workstream = page.getByTestId('home-workstream-workstream_print_cell_qualification');
  await expect(workstream).toHaveAttribute('href', '/aim?group=group_factory&part=stargate');
  await workstream.scrollIntoViewIfNeeded();
  const workstreamBox = await workstream.boundingBox();
  expect(workstreamBox).not.toBeNull();
  if (workstreamBox === null) return;
  await page.mouse.click(workstreamBox.x + 100, workstreamBox.y + workstreamBox.height / 2);
  await expect(page).toHaveURL(/\/aim\?group=group_factory&part=stargate$/);
  await expect(page.getByRole('button', { name: /Factory operations/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await assertNoDocumentOverflow(page);
  expect(unexpectedRequests).toEqual([]);
});
