import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import { AimExperience } from './AimRoute';

function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-search">{location.search}</output>
      <button
        onClick={() => {
          void navigate(-1);
        }}
        type="button"
      >
        Back
      </button>
    </>
  );
}

function renderAim(
  experience: React.ReactNode = <AimExperience />,
  initialEntries: readonly string[] = ['/aim'],
) {
  return render(<MemoryRouter initialEntries={[...initialEntries]}>{experience}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AimExperience', () => {
  it('starts with six primary groups and presents literal hardware before synthetic agents', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderAim();

    expect(screen.getByRole('heading', { name: 'AIM Capability Map' })).toBeInTheDocument();
    expect(screen.getByText('DECLARED CAPABILITY MAP')).toBeInTheDocument();
    const chooser = screen.getByRole('region', { name: /Choose a group/i });
    const groupButtons = within(chooser).getAllByRole('button');
    expect(groupButtons).toHaveLength(6);
    expect(groupButtons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Structures'),
      expect.stringContaining('Propulsion'),
      expect.stringContaining('Factory operations'),
      expect.stringContaining('Integration and test'),
      expect.stringContaining('Quality'),
      expect.stringContaining('Avionics and safety'),
    ]);
    expect(within(chooser).getByRole('button', { name: /Structures/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Structures hardware' })).toBeVisible();
    expect(screen.queryByText('Primary knowledge coverage')).not.toBeInTheDocument();
    expect(screen.queryByText('Resilient agent fleet')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('selects a group and hardware to filter modeled agent coverage', async () => {
    const user = userEvent.setup();
    renderAim();

    const structureHardware = screen.getByRole('group', { name: 'Structures hardware' });
    await user.click(
      within(structureHardware).getByRole('button', { name: /Stage 1 thrust structure/i }),
    );
    expect(screen.getByText(/Printed as an integrated structure/i)).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Agents on Stage 1 thrust structure' }),
    ).toBeVisible();
    expect(screen.getAllByText('CERTIFIED IN SYNTHETIC SEED').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/READ · DECLARED SYNTHETIC REACH/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /Propulsion/ }));
    expect(screen.getByRole('button', { name: /Propulsion/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const propulsionHardware = screen.getByRole('group', { name: 'Propulsion hardware' });
    await user.click(
      within(propulsionHardware).getByRole('button', { name: /Stage 1 engine cluster/i }),
    );
    expect(screen.getByRole('heading', { name: 'Agents on Stage 1 engine cluster' })).toBeVisible();
  });

  it('shows uncovered Quality and Avionics groups without inventing deployment truth', async () => {
    const user = userEvent.setup();
    renderAim();

    await user.click(screen.getByRole('button', { name: /Quality.*NO CURRENT CERTIFIED AGENT/i }));
    expect(screen.getByRole('heading', { name: 'Quality hardware' })).toBeVisible();
    expect(screen.getAllByText('CANDIDATE · SYNTHETIC SEED').length).toBeGreaterThan(0);
    expect(screen.queryByText('CERTIFIED IN SYNTHETIC SEED')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Avionics and safety.*NO CURRENT CERTIFIED AGENT/i }),
    );
    expect(screen.getByRole('heading', { name: 'Avionics and safety hardware' })).toBeVisible();
  });

  it('does not label a non-synthetic manifest or its agents as a public seed', () => {
    const manifest = JSON.parse(seedManifestText) as {
      program: { synthetic: boolean };
      agents: Array<{ synthetic: boolean; connectors: Array<{ assetSrc?: string }> }>;
    };
    manifest.program.synthetic = false;
    manifest.agents.forEach((agent) => {
      agent.synthetic = false;
    });
    const markSource = `/v1/plugins/11111111-1111-4111-8111-111111111111/mark/${'a'.repeat(64)}.svg`;
    manifest.agents[0]!.connectors[0]!.assetSrc = markSource;

    renderAim(<AimExperience manifestText={JSON.stringify(manifest)} />);

    expect(screen.getByText('GOVERNED V2 MANIFEST VALIDATED')).toBeVisible();
    expect(
      screen.getByText(
        'This manifest is not marked synthetic; handle its data under local policy.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('SYNTHETIC SEED')).not.toBeInTheDocument();
    expect(screen.getAllByText('CERTIFICATION EVIDENCE NOT CURRENT').length).toBeGreaterThan(0);
    expect(screen.queryByText('CERTIFIED IN ACTIVE MANIFEST')).not.toBeInTheDocument();
    expect(screen.getAllByText(/READ · DECLARED MANIFEST REACH/).length).toBeGreaterThan(0);
    const localMark = screen
      .getAllByRole('img', { name: 'Lifecycle management connector' })
      .find((mark) => mark.getAttribute('data-has-local-asset') === 'true');
    if (!localMark) throw new Error('Expected a governed local connector mark');
    expect(localMark).toHaveAttribute('data-has-local-asset', 'true');
    expect(localMark.querySelector('img')).toHaveAttribute('src', markSource);
  });

  it('opens evidence only through an explicit selected-hardware action', async () => {
    const user = userEvent.setup();
    renderAim();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const structureHardware = screen.getByRole('group', { name: 'Structures hardware' });
    await user.click(
      within(structureHardware).getByRole('button', { name: /Stage 1 thrust structure/i }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'Inspect Stage 1 thrust structure evidence' }),
    );
    expect(screen.getByRole('dialog', { name: 'Stage 1 thrust structure' })).toBeVisible();
  });

  it('shows validation details and withholds every derived coverage claim for an invalid manifest', () => {
    renderAim(<AimExperience manifestText='{"schemaVersion":"aim.program/v0"}' />);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('MANIFEST INVALID')).toBeInTheDocument();
    expect(
      within(alert).getByRole('heading', { name: 'AIM cannot render this program safely.' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/capability workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/CERTIFIED IN SYNTHETIC SEED/)).not.toBeInTheDocument();
  });

  it('clears a hardware filter when the user changes owning group', async () => {
    const user = userEvent.setup();
    renderAim();

    const structureHardware = screen.getByRole('group', { name: 'Structures hardware' });
    await user.click(
      within(structureHardware).getByRole('button', { name: /Stage 1 thrust structure/i }),
    );
    expect(
      screen.getByRole('heading', { name: 'Agents on Stage 1 thrust structure' }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: /Propulsion/ }));

    expect(screen.getByRole('heading', { name: 'Propulsion agents' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Inspect Stage 1 thrust structure evidence' }),
    ).not.toBeInTheDocument();
  });

  it('initializes the static map from an exact group and owned part deep link', () => {
    renderAim(undefined, ['/aim?group=group_factory&part=stargate']);

    expect(screen.getByRole('button', { name: /Factory operations/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: 'Agents on Additive manufacturing cell' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Inspect Additive manufacturing cell evidence' }),
    ).toBeVisible();
  });

  it.each([
    '/aim?group=group_factory&part=s1_engines',
    '/aim?group=group_missing&part=stargate',
    '/aim?group=group_missing&part=part_missing',
  ])('ignores invalid or mismatched route selection %s without crashing', (initialEntry) => {
    renderAim(undefined, [initialEntry]);

    expect(screen.queryByRole('heading', { name: /Agents on / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Inspect .* evidence$/ })).not.toBeInTheDocument();
  });

  it('writes exact selections to history so browser back restores prior map state', async () => {
    const user = userEvent.setup();
    renderAim(
      <>
        <AimExperience />
        <LocationControls />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /Factory operations/ }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('group=group_factory');

    const factoryHardware = screen.getByRole('group', { name: 'Factory operations hardware' });
    await user.click(
      within(factoryHardware).getByRole('button', { name: /Additive manufacturing cell/i }),
    );
    expect(screen.getByTestId('location-search')).toHaveTextContent(
      'group=group_factory&part=stargate',
    );

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('?group=group_factory');
    expect(screen.getByRole('heading', { name: 'Factory operations agents' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('location-search')).toBeEmptyDOMElement();
    expect(screen.getByRole('heading', { name: 'Structures hardware' })).toBeVisible();
  });
});
