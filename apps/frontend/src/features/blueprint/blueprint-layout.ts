import type { AgentSpec } from '@agent-builder/contracts';

export type BlueprintStationId = 'scope' | 'knowledge' | 'workflow' | 'criteria';

export interface BlueprintPoint {
  x: number;
  y: number;
}

export interface BlueprintRect extends BlueprintPoint {
  width: number;
  height: number;
}

export interface BlueprintStation {
  id: BlueprintStationId;
  index: number;
  label: string;
  complete: boolean;
  rect: BlueprintRect;
  lines: string[];
}

export interface BlueprintConnector {
  id: string;
  from: BlueprintPoint;
  to: BlueprintPoint;
  complete: boolean;
  completedBy: BlueprintStationId;
}

export interface BlueprintTitleBlock {
  rect: BlueprintRect;
  title: string;
  revision: string;
  date: string;
  department: string;
  audience: string;
  status: string;
}

export interface BlueprintLayout {
  width: number;
  height: number;
  gridSize: number;
  frame: BlueprintRect;
  registrationMarks: BlueprintPoint[];
  stations: BlueprintStation[];
  connectors: BlueprintConnector[];
  titleBlock: BlueprintTitleBlock;
  watermark: {
    text: 'DRAFT' | 'READY FOR GENERATION';
    ready: boolean;
  };
}

export function completionKeyForStation(id: BlueprintStationId): keyof AgentSpec['completion'] {
  if (id === 'scope') return 'outcomes';
  if (id === 'workflow') return 'guardrails';
  if (id === 'criteria') return 'outputs';
  return 'knowledge';
}

const EMPTY_COMPLETION = {
  outcomes: false,
  knowledge: false,
  guardrails: false,
  outputs: false,
} as const;

const STATUS_LABELS: Readonly<Record<AgentSpec['status'], string>> = {
  draft: 'DRAFT',
  ready: 'READY',
  generating: 'GENERATING',
  generated: 'GENERATED',
};

function boundedDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

/** Truncates at the requested character boundary, including the ellipsis. */
export function truncateBlueprintText(value: string, maxCharacters: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (maxCharacters <= 0) return '';
  if (normalized.length <= maxCharacters) return normalized;
  if (maxCharacters === 1) return '…';
  return `${normalized.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function lineCapacity(rect: BlueprintRect): number {
  return Math.max(4, Math.floor((rect.width - 24) / 6.6));
}

function stationLines(
  id: BlueprintStationId,
  spec: AgentSpec | null | undefined,
  capacity: number,
): string[] {
  if (!spec?.completion[completionKeyForStation(id)]) {
    return ['PENDING'];
  }

  if (id === 'scope' && spec.outcomes) {
    return [
      truncateBlueprintText(`DEPT · ${spec.outcomes.department}`, capacity),
      truncateBlueprintText(`AUDIENCE · ${spec.outcomes.audience}`, capacity),
      truncateBlueprintText(
        `${spec.outcomes.desiredOutcomes.length} DESIRED OUTCOME${spec.outcomes.desiredOutcomes.length === 1 ? '' : 'S'}`,
        capacity,
      ),
    ];
  }

  if (id === 'knowledge' && spec.knowledge) {
    const sourceLines = spec.knowledge.sources
      .slice(0, 2)
      .map((source, index) =>
        truncateBlueprintText(
          `0${index + 1} · ${source.descriptorId.replace(/[-_]+/g, ' ')}`,
          capacity,
        ),
      );
    return [
      truncateBlueprintText(
        `${spec.knowledge.sources.length} SOURCE${spec.knowledge.sources.length === 1 ? '' : 'S'}`,
        capacity,
      ),
      ...sourceLines,
    ];
  }

  if (id === 'workflow' && spec.guardrails) {
    return [
      truncateBlueprintText(`${spec.guardrails.workflowStages.length} STAGES`, capacity),
      truncateBlueprintText(`${spec.guardrails.approvalRequirements.length} APPROVALS`, capacity),
      truncateBlueprintText(`${spec.guardrails.prohibitedActions.length} PROHIBITED`, capacity),
    ];
  }

  if (id === 'criteria' && spec.outputs) {
    const schemaNameValue =
      spec.outputs.outputSchema['title'] ??
      spec.outputs.outputSchema['name'] ??
      spec.outputs.outputSchema['$id'] ??
      spec.outputs.outputType;
    const schemaName =
      typeof schemaNameValue === 'string' ? schemaNameValue : spec.outputs.outputType;
    return [
      truncateBlueprintText(`${spec.outputs.successMetrics.length} METRICS`, capacity),
      truncateBlueprintText(`SCHEMA · ${schemaName}`, capacity),
      truncateBlueprintText(`${spec.outputs.acceptanceTests.length} ACCEPTANCE TESTS`, capacity),
    ];
  }

  return ['PENDING'];
}

function deterministicDate(spec: AgentSpec | null | undefined): string {
  const value = spec?.updatedAt;
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toISOString().slice(0, 10);
}

export function layoutBlueprint(
  spec: AgentSpec | null | undefined,
  width: number,
  height: number,
): BlueprintLayout {
  const canvasWidth = boundedDimension(width, 1200);
  const canvasHeight = boundedDimension(height, 640);
  const compact = canvasWidth < 720;
  const frameInset = compact ? 16 : 32;
  const frame: BlueprintRect = {
    x: frameInset,
    y: frameInset,
    width: Math.max(1, canvasWidth - frameInset * 2),
    height: Math.max(1, canvasHeight - frameInset * 2),
  };

  const stationGap = compact ? 8 : 22;
  const stationAreaWidth = frame.width - (compact ? 20 : 64);
  const stationWidth = Math.max(36, (stationAreaWidth - stationGap * 3) / 4);
  const stationHeight = Math.min(compact ? 156 : 184, Math.max(100, frame.height * 0.33));
  const stationY = frame.y + Math.max(72, frame.height * 0.19);
  const stationStartX = frame.x + (frame.width - (stationWidth * 4 + stationGap * 3)) / 2;
  const completion = spec?.completion ?? EMPTY_COMPLETION;
  const definitions = [
    { id: 'scope' as const, label: 'SCOPE', complete: completion.outcomes },
    { id: 'knowledge' as const, label: 'KNOWLEDGE', complete: completion.knowledge },
    { id: 'workflow' as const, label: 'WORKFLOW', complete: completion.guardrails },
    { id: 'criteria' as const, label: 'CRITERIA', complete: completion.outputs },
  ];

  const stations = definitions.map((definition, index): BlueprintStation => {
    const rect: BlueprintRect = {
      x: stationStartX + index * (stationWidth + stationGap),
      y: stationY,
      width: stationWidth,
      height: stationHeight,
    };
    return {
      ...definition,
      index,
      rect,
      lines: stationLines(definition.id, spec, lineCapacity(rect)),
    };
  });

  const connectors: BlueprintConnector[] = stations.slice(0, -1).map((station, index) => {
    const nextStation = stations[index + 1];
    if (!nextStation) {
      throw new Error('Blueprint station sequence is incomplete.');
    }
    return {
      id: `${station.id}-${nextStation.id}`,
      from: {
        x: station.rect.x + station.rect.width,
        y: station.rect.y + station.rect.height / 2,
      },
      to: {
        x: nextStation.rect.x,
        y: nextStation.rect.y + nextStation.rect.height / 2,
      },
      complete: station.complete,
      completedBy: station.id,
    };
  });

  const titleBlockWidth = Math.min(compact ? frame.width * 0.72 : 390, frame.width);
  const titleBlockHeight = Math.min(124, Math.max(92, frame.height * 0.22));
  const titleFieldCapacity = Math.max(4, Math.floor((titleBlockWidth * 0.58 - 20) / 5.4));
  const titleBlock: BlueprintTitleBlock = {
    rect: {
      x: frame.x + frame.width - titleBlockWidth,
      y: frame.y + frame.height - titleBlockHeight,
      width: titleBlockWidth,
      height: titleBlockHeight,
    },
    title: truncateBlueprintText(
      spec?.outcomes?.purpose ?? 'UNTITLED AGENT',
      Math.min(40, titleFieldCapacity),
    ),
    revision: spec ? `REV ${spec.revision}` : 'REV —',
    date: deterministicDate(spec),
    department: truncateBlueprintText(
      `DEPT · ${spec?.outcomes?.department ?? '—'}`,
      titleFieldCapacity,
    ),
    audience: truncateBlueprintText(`AUD · ${spec?.outcomes?.audience ?? '—'}`, titleFieldCapacity),
    status: spec ? STATUS_LABELS[spec.status] : 'DRAFT',
  };

  const allComplete =
    completion.outcomes && completion.knowledge && completion.guardrails && completion.outputs;

  return {
    width: canvasWidth,
    height: canvasHeight,
    gridSize: 24,
    frame,
    registrationMarks: [
      { x: frame.x, y: frame.y },
      { x: frame.x + frame.width, y: frame.y },
      { x: frame.x, y: frame.y + frame.height },
      { x: frame.x + frame.width, y: frame.y + frame.height },
    ],
    stations,
    connectors,
    titleBlock,
    watermark: {
      text: allComplete ? 'READY FOR GENERATION' : 'DRAFT',
      ready: allComplete,
    },
  };
}
