import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarfieldCanvas } from './StarfieldCanvas';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StarfieldCanvas', () => {
  it('renders the static noise fallback when reduced motion is requested', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        (query: string): MediaQueryList => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      ),
    );

    const { container } = render(<StarfieldCanvas />);

    expect(container.querySelector('[data-starfield-fallback="true"]')).toHaveClass('noise');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });
});
