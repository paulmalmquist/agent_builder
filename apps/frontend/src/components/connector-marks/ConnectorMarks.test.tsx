import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithClient } from '../../test/render';
import {
  AgentCapabilitySchematic,
  AgentCapabilityStrip,
  type AgentConnectorCapability,
} from './AgentCapabilitySchematic';
import { ConnectorMark } from './ConnectorMark';

const capabilities: AgentConnectorCapability[] = [
  {
    id: 'records-read',
    name: 'Planning records',
    detail: 'Read bounded synthetic planning records.',
    effect: 'read',
    authority: 'granted',
    brand: { monogram: 'SP', accent: '#B9AAFF' },
  },
  {
    id: 'records-write',
    name: 'Work items',
    detail: 'Create a proposed work item after approval.',
    effect: 'write',
    authority: 'declared',
    brand: { monogram: 'WI', accent: '#E8B34B' },
  },
];

describe('connector marks', () => {
  it('renders a monogram fallback and never loads a remote asset source', () => {
    renderWithClient(
      <ConnectorMark
        definition={{
          monogram: 'SP',
          accent: '#B9AAFF',
          assetSrc: 'https://assets.example.invalid/mark.svg',
        }}
        label="Synthetic planning"
      />,
    );

    const mark = screen.getByRole('img', { name: 'Synthetic planning connector' });
    expect(mark).toHaveTextContent('SP');
    expect(within(mark).queryByRole('img', { hidden: true })).not.toBeInTheDocument();
    expect(mark).toHaveAttribute('data-has-local-asset', 'false');
  });

  it('uses a same-application SVG and reveals the monogram if it fails', () => {
    const assetSrc =
      '/v1/plugins/d0000000-0000-4000-8000-000000000001/mark/' + `${'a'.repeat(64)}.svg`;
    renderWithClient(
      <ConnectorMark
        definition={{ monogram: 'SP', accent: '#B9AAFF', assetSrc }}
        label="Synthetic planning"
      />,
    );

    const mark = screen.getByRole('img', { name: 'Synthetic planning connector' });
    const image = mark.querySelector('img');
    expect(image).toHaveAttribute('src', assetSrc);
    fireEvent.error(image!);
    expect(image).toHaveAttribute('hidden');
    expect(mark).toHaveTextContent('SP');
  });

  it('makes effect and current authority available without relying on color', () => {
    renderWithClient(
      <AgentCapabilitySchematic agentName="Planning review" capabilities={capabilities} />,
    );

    expect(screen.getByRole('heading', { name: 'KNOWS · READ ONLY' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CAN DO' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Read; allowed by a current grant' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Write; declared, not granted' })).toBeInTheDocument();
    expect(screen.getByText('Declared, not granted')).toBeInTheDocument();
  });

  it('compresses the same effect and authority semantics into a labeled strip', () => {
    renderWithClient(
      <AgentCapabilityStrip agentName="Planning review" capabilities={capabilities} />,
    );

    const strip = screen.getByRole('list', { name: 'Planning review connector reach' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(2);
    expect(
      within(strip).getByText(/Planning records: Read; allowed by a current grant/),
    ).toBeInTheDocument();
    expect(within(strip).getByText(/Work items: Write; declared, not granted/)).toBeInTheDocument();
    expect(within(strip).getAllByRole('listitem')[1]).toHaveAttribute('data-authority', 'declared');
  });
});
