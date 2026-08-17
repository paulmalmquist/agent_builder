import { screen, within } from '@testing-library/react';
import { HomePage } from './HomePage';
import { renderWithClient } from '../../test/render';

describe('HomePage', () => {
  it('introduces the whole platform with one primary action and every governed workspace', () => {
    renderWithClient(<HomePage aimEnabled />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Build, run, prove, and improve governed work.',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.querySelectorAll('.primary-button')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Open Attention/i })).toHaveAttribute(
      'href',
      '/attention',
    );
    expect(
      screen.getByText('Opens the governed queue for decisions and degraded work.'),
    ).toBeVisible();
    expect(screen.getByText('Return home without changing any item.')).toBeVisible();

    const reviewRule = screen.getByRole('complementary', { name: 'One place for review' });
    expect(within(reviewRule).getByText('Attention owns interruption.')).toBeVisible();
    expect(
      within(reviewRule).getByText('Attention is the only place that interrupts you.'),
    ).toBeVisible();
    expect(
      within(reviewRule).getByText(
        'Daily Briefing carries informational activity without a badge.',
      ),
    ).toBeVisible();

    expect(screen.getByRole('link', { name: /Build or reuse/i })).toHaveAttribute('href', '/build');
    expect(screen.getByRole('link', { name: /Open registry/i })).toHaveAttribute(
      'href',
      '/registry',
    );
    expect(screen.getByRole('link', { name: /Review runs/i })).toHaveAttribute('href', '/runs');
    expect(screen.getByRole('link', { name: /Review evidence/i })).toHaveAttribute(
      'href',
      '/evidence',
    );
    expect(screen.getByRole('link', { name: /Open incubator/i })).toHaveAttribute(
      'href',
      '/incubator',
    );
    expect(screen.getByRole('link', { name: /Open capability map/i })).toHaveAttribute(
      'href',
      '/aim',
    );
    expect(screen.getByText('SYNTHETIC CAPABILITY VEHICLE · NOT CAD')).toBeVisible();
  });

  it('keeps decisions, degradation, and digest content inside Attention', () => {
    renderWithClient(<HomePage aimEnabled={false} />);

    expect(
      screen.queryByRole('heading', {
        name: 'Daily Briefing is ready for its first approved run',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('34 runs · $2.10 · 2 promotions this week')).not.toBeInTheDocument();
    expect(screen.queryByText('All quiet')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open capability map/i })).not.toBeInTheDocument();
  });
});
