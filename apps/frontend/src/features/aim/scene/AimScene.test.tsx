import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AimScene, type AimVehicleRendererLoader } from './AimScene';
import type { AimSceneModel, AimVehicleRenderer } from './scene-types';

function matchMedia(reduced: boolean) {
  return vi.fn(
    (query: string): MediaQueryList => ({
      matches: reduced && query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    }),
  );
}

const model: AimSceneModel = {
  programId: 'aim_program',
  label: 'Synthetic manufacturing program',
  asOf: '2026-08-17T12:00:00.000Z',
  geometryDisclaimer: 'CONCEPTUAL GEOMETRY — NOT VEHICLE CAD',
  isSynthetic: true,
  parts: [
    {
      id: 'program_foundation',
      label: 'Program foundation',
      anchor: {
        kind: 'mapped',
        resolution: 'exact',
        requestedAnchorId: 's1_thrust',
        anchor: {
          id: 's1_thrust',
          aliases: ['boattail'],
          region: 'stage_1',
          shape: 'cone',
          position: [0, -3.7, 0],
          scale: [1.18, 0.72, 1.18],
        },
      },
      lifecycle: 'poc',
      readiness: 'conditional',
      evidenceState: 'satisfied',
      evidenceMessage: 'EVIDENCE CURRENT',
      material: 'additive_reveal',
      additiveRevealProgress: 0.55,
      problem: 'Unify governed program facts into a reviewable capability map.',
      capabilityLabels: ['Governed data · FOUNDATION'],
      groupLabels: ['Program operations'],
      decisionLoopLabels: ['Program readiness'],
      latency: { baseline: '5 days', current: '2 days', target: '1 days' },
      evidence: [],
      sourceLabels: ['Synthetic seed'],
      lastSynchronizedAt: '2026-08-17T10:00:00.000Z',
      unlockLabels: [],
      dependencyLabels: [],
    },
    {
      id: 'future_capability',
      label: 'Future capability',
      anchor: {
        kind: 'fallback',
        resolution: 'fallback',
        requestedAnchorId: 'future_anchor',
        fallbackRegion: 'future',
      },
      lifecycle: 'planned',
      readiness: 'unknown',
      evidenceState: 'not_required',
      evidenceMessage: 'GO EVIDENCE NOT REQUIRED AT THIS STATE',
      material: 'wireframe',
      additiveRevealProgress: 0,
      problem: 'Hold a safe interaction point before proxy geometry exists.',
      capabilityLabels: ['Future capability · OUTCOME'],
      groupLabels: ['Program operations'],
      decisionLoopLabels: [],
      latency: {},
      evidence: [],
      sourceLabels: ['Synthetic seed'],
      unlockLabels: [],
      dependencyLabels: [],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AimScene', () => {
  it('uses the interactive renderer, exposes equivalent controls, and disposes on unmount', async () => {
    const onSelectPart = vi.fn();
    const dispose = vi.fn();
    const renderer: AimVehicleRenderer = {
      mode: 'webgl',
      setModel: vi.fn(),
      resize: vi.fn(),
      pick: vi.fn(() => 'program_foundation'),
      dispose,
    };
    const factory = vi.fn(() => renderer);
    const loader: AimVehicleRendererLoader = vi.fn(() => Promise.resolve(factory));

    const result = render(
      <AimScene model={model} onSelectPart={onSelectPart} rendererLoader={loader} />,
    );

    expect(await screen.findByText('WEBGL · LOCAL CONCEPTUAL PROXY')).toBeInTheDocument();
    expect(factory).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      model,
      expect.objectContaining({ reducedMotion: false }),
    );
    fireEvent.click(result.container.querySelector('canvas')!, { clientX: 12, clientY: 18 });
    expect(onSelectPart).toHaveBeenCalledWith('program_foundation');

    await userEvent.click(screen.getByRole('button', { name: 'Program foundation' }));
    expect(onSelectPart).toHaveBeenLastCalledWith('program_foundation');
    result.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('fails visibly to the complete 2D interface when WebGL cannot initialize', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onSelectPart = vi.fn();
    const loader: AimVehicleRendererLoader = vi.fn(() =>
      Promise.reject(new Error('webgl unavailable')),
    );
    render(<AimScene model={model} onSelectPart={onSelectPart} rendererLoader={loader} />);

    expect(
      await screen.findByText(
        /3D rendering is unavailable\. This 2D view preserves every program action/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('GEOMETRY ANCHOR NOT YET MAPPED')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Future capability/i }));
    expect(onSelectPart).toHaveBeenCalledWith('future_capability');
    expect(warning).toHaveBeenCalledWith(
      'AIM WebGL renderer unavailable; using the 2D program view.',
      expect.any(Error),
    );
  });

  it('does not load or animate the 3D renderer when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', matchMedia(true));
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    const loader: AimVehicleRendererLoader = vi.fn(() =>
      Promise.reject(new Error('must not load')),
    );
    render(<AimScene model={model} onSelectPart={vi.fn()} rendererLoader={loader} />);

    expect(await screen.findByText(/Motion is reduced/)).toBeInTheDocument();
    await waitFor(() => expect(loader).not.toHaveBeenCalled());
    expect(requestFrame).not.toHaveBeenCalled();
  });
});
