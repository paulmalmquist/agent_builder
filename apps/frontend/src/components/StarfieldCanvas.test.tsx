import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarfieldCanvas } from './StarfieldCanvas';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('StarfieldCanvas', () => {
  it('keeps the persistent shell background static for every motion preference', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const requestAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);

    const { container } = render(<StarfieldCanvas />);

    expect(container.querySelector('[data-starfield-fallback="true"]')).toHaveClass('noise');
    expect(container.querySelector('[data-starfield-mode="static"]')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(getContext).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });
});
