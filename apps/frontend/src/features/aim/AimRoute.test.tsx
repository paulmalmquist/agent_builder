import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import { AimExperience } from './AimRoute';

function reducedMotionMatchMedia(query: string): MediaQueryList {
  return {
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(reducedMotionMatchMedia));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AimExperience', () => {
  it('loads the local seed offline and opens a manifest-driven POC card', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(<AimExperience />);

    expect(screen.getByRole('heading', { name: 'AIM Capability Vehicle' })).toBeInTheDocument();
    expect(screen.getByText('CONCEPTUAL GEOMETRY — NOT VEHICLE CAD')).toBeInTheDocument();
    expect(screen.getByText('SYNTHETIC SEED')).toBeInTheDocument();
    expect(await screen.findByText(/Motion is reduced/)).toBeInTheDocument();

    const componentStack = screen.getByRole('region', {
      name: 'AIM conceptual component stack',
    });
    const foundation = within(componentStack).getByRole('button', {
      name: /Governed data foundation/i,
    });
    await user.click(foundation);

    const dialog = screen.getByRole('dialog', { name: 'Governed data foundation' });
    expect(within(dialog).getByText('MANIFEST-DRIVEN POC CARD')).toBeInTheDocument();
    expect(within(dialog).getByText('PROBLEM')).toBeInTheDocument();
    expect(within(dialog).getByText('PARTICIPATING GROUPS')).toBeInTheDocument();
    expect(within(dialog).getByText('CAPABILITY LAYER')).toBeInTheDocument();
    expect(within(dialog).getByText('EVIDENCE')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole('button', { name: /Close Governed data foundation/ }),
    );
    expect(foundation).toHaveFocus();
  });

  it('shows validation details and withholds the scene for an invalid manifest', () => {
    render(<AimExperience manifestText='{"schemaVersion":"aim.program/v0"}' />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('MANIFEST INVALID')).toBeInTheDocument();
    expect(
      within(alert).getByRole('heading', { name: 'AIM cannot render this program safely.' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('AIM conceptual program vehicle')).not.toBeInTheDocument();
  });

  it('renders an unmapped anchor as a clickable fallback instead of crashing', async () => {
    const user = userEvent.setup();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manifest = JSON.parse(seedManifestText) as {
      anchors: Array<Record<string, unknown>>;
      parts: Array<Record<string, unknown>>;
    };
    manifest.anchors.push({
      id: 'future_anchor',
      label: 'Future conceptual anchor',
      kind: 'vehicle',
      aliases: [],
    });
    const firstPart = manifest.parts[0]!;
    firstPart['anchorId'] = 'future_anchor';
    delete firstPart['fallbackRegion'];

    render(<AimExperience manifestText={JSON.stringify(manifest)} />);

    expect(await screen.findByText('GEOMETRY ANCHOR NOT YET MAPPED')).toBeInTheDocument();
    const fallback = screen.getByRole('button', { name: /Resilient agent fleet/i });
    await user.click(fallback);
    expect(screen.getByRole('dialog', { name: 'Resilient agent fleet' })).toBeInTheDocument();
    expect(warning).toHaveBeenCalledWith(
      'AIM conceptual geometry has unmapped anchors: future_anchor.',
    );
  });
});
