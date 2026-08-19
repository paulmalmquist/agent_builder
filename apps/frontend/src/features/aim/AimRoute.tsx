import { useMemo, useState } from 'react';
import { consoleCriticalCopy } from '@agent-builder/contracts';
import { loadAimProgram, stateAt } from '@paul-os/runtime/aim';
import { useSearchParams } from 'react-router-dom';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import { InstrumentStrip, SurfaceHeader } from '../platform/SurfaceHeader';
import { createAimViewModel, type AimViewModel } from './aim-view-model';
import { AimAgentPanel, AimGroupSelector, AimManufacturingPanel } from './AimWorkspacePanels';
import { ManifestErrorPanel, type AimManifestIssue } from './ManifestErrorPanel';
import { PocCard } from './PocCard';
import './aim-workspace.css';

const aimCopy = consoleCriticalCopy.aim;

type AimRouteState =
  | { ok: true; model: AimViewModel }
  | { ok: false; issues: readonly AimManifestIssue[] };

function loadViewModel(manifestText: string): AimRouteState {
  const loaded = loadAimProgram(manifestText);
  if (!loaded.ok) {
    return {
      ok: false,
      issues: loaded.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  try {
    const state = stateAt(loaded.manifest, loaded.manifest.program.asOf);
    return { ok: true, model: createAimViewModel(loaded.manifest, state) };
  } catch (error: unknown) {
    console.warn('AIM program projection failed; no capability map was rendered.', error);
    return {
      ok: false,
      issues: [
        {
          code: 'projection_failed',
          path: '$',
          message: 'The validated manifest could not be projected at its declared as-of time.',
        },
      ],
    };
  }
}

interface AimExperienceProps {
  manifestText?: string;
}

export function AimExperience({ manifestText = seedManifestText }: AimExperienceProps) {
  const routeState = useMemo(() => loadViewModel(manifestText), [manifestText]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [evidencePartId, setEvidencePartId] = useState<string | null>(null);

  if (!routeState.ok) return <ManifestErrorPanel issues={routeState.issues} />;

  const { model } = routeState;
  const primaryGroups = model.groups
    .filter((group) => group.kind === 'primary')
    .sort((left, right) => left.displayOrder - right.displayOrder);
  const defaultGroup = primaryGroups[0];
  if (!defaultGroup) {
    return (
      <ManifestErrorPanel
        issues={[
          {
            code: 'primary_group_missing',
            path: 'groups',
            message: 'AIM requires at least one primary hardware-owning group.',
          },
        ]}
      />
    );
  }
  const requestedGroupId = searchParams.get('group');
  const requestedPartId = searchParams.get('part');
  const requestedGroup = primaryGroups.find((group) => group.id === requestedGroupId);
  const requestedPart = model.parts.find((part) => part.id === requestedPartId);
  const routePartIsValid =
    requestedPart !== undefined &&
    (requestedGroupId === null || requestedGroup?.id === requestedPart.ownerGroupId);
  const selectedGroup = routePartIsValid
    ? (primaryGroups.find((group) => group.id === requestedPart.ownerGroupId) ?? defaultGroup)
    : (requestedGroup ?? defaultGroup);
  const selectedPart =
    routePartIsValid && requestedPart.ownerGroupId === selectedGroup.id ? requestedPart : null;
  const evidencePart =
    evidencePartId === null
      ? null
      : (model.parts.find((part) => part.id === evidencePartId) ?? null);
  const groupParts = model.parts.filter((part) => part.ownerGroupId === selectedGroup.id);
  const groupAgents = model.agents.filter((agent) => {
    if (selectedPart) return agent.partIds.includes(selectedPart.id);
    return selectedGroup.agentIds.includes(agent.id);
  });
  const evidenceWarnings = model.parts.filter(
    (part) => part.evidenceState === 'missing' || part.evidenceState === 'stale',
  ).length;
  const uncoveredGroups = primaryGroups.filter((group) => !group.hasCertifiedAgent).length;
  const readings = [
    { label: 'PRIMARY GROUPS', value: primaryGroups.length },
    { label: 'MODELED AGENTS', value: model.agents.length },
    { label: 'COVERAGE GAPS', value: uncoveredGroups },
    { label: 'EVIDENCE WARNINGS', value: evidenceWarnings },
    { label: 'AS OF', value: model.asOf.slice(0, 10) },
  ];

  function selectGroup(groupId: string) {
    const group = primaryGroups.find((candidate) => candidate.id === groupId);
    if (!group) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('group', group.id);
    nextSearchParams.delete('part');
    setSearchParams(nextSearchParams);
    setEvidencePartId(null);
  }

  function selectPart(partId: string) {
    const part = model.parts.find((candidate) => candidate.id === partId);
    if (!part) return;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('group', part.ownerGroupId);
    nextSearchParams.set('part', part.id);
    setSearchParams(nextSearchParams);
    setEvidencePartId(null);
  }

  return (
    <main className="os-surface aim-surface">
      <SurfaceHeader
        description={aimCopy.introduction.join(' ')}
        kicker="AIM · MANUFACTURING CAPABILITY MAP"
        stateDetail={
          model.isSynthetic
            ? 'OFFLINE · DECLARED HARDWARE · SYNTHETIC COVERAGE'
            : 'OFFLINE · DECLARED HARDWARE · DECLARED COVERAGE'
        }
        stateLabel={
          model.isSynthetic ? 'LOCAL V2 MANIFEST VALIDATED' : 'GOVERNED V2 MANIFEST VALIDATED'
        }
        title={model.label}
      />
      <InstrumentStrip readings={readings} />
      <section className="aim-program-notice">
        <div>
          <strong>DECLARED CAPABILITY MAP</strong>
          <p>{aimCopy.body?.[0]}</p>
          <p>{model.isSynthetic ? aimCopy.body?.[1] : aimCopy.body?.[2]}</p>
        </div>
        {model.isSynthetic ? <small>SYNTHETIC SEED</small> : null}
      </section>
      <AimGroupSelector
        groups={primaryGroups}
        onSelect={selectGroup}
        selectedGroupId={selectedGroup.id}
      />
      <section className="aim-workspace" aria-label={`${selectedGroup.label} capability workspace`}>
        <div className="aim-hardware-column">
          <header className="aim-owner-summary">
            <div>
              <span>SELECTED OWNER</span>
              <h2>{selectedGroup.label}</h2>
            </div>
            <p>{selectedGroup.description}</p>
          </header>
          <AimManufacturingPanel
            group={selectedGroup}
            onSelectPart={selectPart}
            parts={groupParts}
            selectedPartId={selectedPart?.id ?? null}
          />
          {selectedPart ? (
            <button
              className="secondary-button aim-evidence-button"
              onClick={() => setEvidencePartId(selectedPart.id)}
              type="button"
            >
              Inspect {selectedPart.label} evidence
            </button>
          ) : null}
        </div>
        <AimAgentPanel agents={groupAgents} group={selectedGroup} selectedPart={selectedPart} />
      </section>
      {evidencePart ? (
        <PocCard onClose={() => setEvidencePartId(null)} part={evidencePart} />
      ) : null}
    </main>
  );
}

export function AimRoute() {
  return <AimExperience />;
}
