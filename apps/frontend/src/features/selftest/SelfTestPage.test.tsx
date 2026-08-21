import { screen, waitFor } from '@testing-library/react';
import type { SelfTestReport } from '@agent-builder/contracts';
import { renderWithClient } from '../../test/render';

const runSelfTestMatrix = vi.hoisted(() => vi.fn());

vi.mock('./selftest-runner', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as Record<string, unknown>), runSelfTestMatrix };
});

import { SelfTestPage } from './SelfTestPage';

const completedReport: SelfTestReport = {
  schemaVersion: 'paul-os.selftest/v1',
  commit: null,
  generatedAt: '2026-08-21T12:00:00.000Z',
  widths: [390],
  summary: { pass: 1, fail: 0, skipped: 0 },
  results: [
    {
      id: 'viewport.achieved',
      width: 390,
      status: 'PASS',
      description: 'The iframe exposes the exact requested CSS viewport.',
      expected: '390×844',
      actual: '390×844',
      route: '/selftest',
    },
  ],
};

describe('SelfTestPage', () => {
  beforeEach(() => {
    runSelfTestMatrix.mockReset();
    delete window.__PAUL_OS_SELFTEST_REPORT__;
  });

  it('publishes the completed report to the accessible table and stable machine contract', async () => {
    runSelfTestMatrix.mockResolvedValue(completedReport);
    const { container } = renderWithClient(<SelfTestPage />, ['/selftest?w=390']);

    expect(screen.getByRole('heading', { level: 1, name: 'Self-verification' })).toBeVisible();
    expect(screen.getByTitle('Live Paul OS application under acceptance test')).toHaveAttribute(
      'width',
      '390',
    );
    await waitFor(() =>
      expect(container.querySelector('[data-selftest-status="complete"]')).toBeInTheDocument(),
    );

    expect(screen.getByRole('cell', { name: 'PASS' })).toBeVisible();
    expect(window.__PAUL_OS_SELFTEST_REPORT__).toEqual(completedReport);
    const serialized = container.querySelector('#paul-os-selftest-report')?.textContent ?? '';
    expect(JSON.parse(serialized)).toEqual(completedReport);
  });

  it('completes with explicit skipped rows when the runner itself is unavailable', async () => {
    runSelfTestMatrix.mockRejectedValue(new Error('Frame access unavailable'));
    const { container } = renderWithClient(<SelfTestPage />, ['/selftest?w=390']);

    await waitFor(() =>
      expect(container.querySelector('[data-selftest-status="complete"]')).toBeInTheDocument(),
    );
    expect(window.__PAUL_OS_SELFTEST_REPORT__?.summary).toEqual({
      pass: 0,
      fail: 0,
      skipped: 20,
    });
    expect(screen.getAllByRole('cell', { name: 'SKIPPED' })).toHaveLength(20);
  });
});
