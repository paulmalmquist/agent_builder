import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { loadAimProgram, stateAt } from '@paul-os/runtime/aim';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import { InstrumentStrip, SurfaceHeader } from '../platform/SurfaceHeader';
import { createAimSceneModel } from './aim-scene-adapter';
import { ManifestErrorPanel, type AimManifestIssue } from './ManifestErrorPanel';
import { PocCard } from './PocCard';
import { Aim2DFallback } from './scene/Aim2DFallback';
import type { AimSceneModel } from './scene/scene-types';

const LazyAimScene = lazy(async () => {
  const { AimScene } = await import('./scene/AimScene');
  return { default: AimScene };
});

type AimRouteState =
  | { ok: true; model: AimSceneModel }
  | { ok: false; issues: readonly AimManifestIssue[] };

function loadSceneModel(manifestText: string): AimRouteState {
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
    return { ok: true, model: createAimSceneModel(loaded.manifest, state) };
  } catch (error: unknown) {
    console.warn('AIM program projection failed; no scene state was rendered.', error);
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
  const routeState = useMemo(() => loadSceneModel(manifestText), [manifestText]);
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const fallbackAnchorKey = routeState.ok
    ? routeState.model.parts
        .filter((part) => part.anchor.kind === 'fallback')
        .map((part) => part.anchor.requestedAnchorId)
        .sort()
        .join('|')
    : '';

  useEffect(() => {
    if (!fallbackAnchorKey) return;
    console.warn(
      `AIM conceptual geometry has unmapped anchors: ${fallbackAnchorKey.split('|').join(', ')}.`,
    );
  }, [fallbackAnchorKey]);

  if (!routeState.ok) return <ManifestErrorPanel issues={routeState.issues} />;

  const { model } = routeState;
  const selectedPart =
    selectedPartId === null ? undefined : model.parts.find((part) => part.id === selectedPartId);
  const evidenceWarnings = model.parts.filter(
    (part) => part.evidenceState === 'missing' || part.evidenceState === 'stale',
  ).length;
  const additiveParts = model.parts.filter((part) => part.material === 'additive_reveal').length;
  const readings = [
    { label: 'CAPABILITY COMPONENTS', value: model.parts.length },
    { label: 'ADDITIVE POC', value: additiveParts },
    { label: 'EVIDENCE WARNINGS', value: evidenceWarnings },
    { label: 'AS OF', value: model.asOf.slice(0, 10) },
  ];

  return (
    <main className="os-surface aim-surface">
      <SurfaceHeader
        description={
          model.description ??
          'Inspect how governed program capabilities build into one synthetic manufacturing system.'
        }
        kicker="AIM · MANUFACTURING CAPABILITY MAP"
        stateDetail="OFFLINE · SYNTHETIC PROGRAM DATA"
        stateLabel="LOCAL MANIFEST VALIDATED"
        title={model.label}
      />
      <InstrumentStrip readings={readings} />
      <section className="aim-geometry-notice">
        <span aria-hidden="true">◇</span>
        <div>
          <strong>{model.geometryDisclaimer}</strong>
          <p>
            This vehicle is a conceptual capability proxy. It contains no authentic dimensions,
            routing, process recipes, or protected design data.
          </p>
        </div>
        {model.isSynthetic ? <small>SYNTHETIC SEED</small> : null}
      </section>
      <Suspense
        fallback={<Aim2DFallback model={model} onSelectPart={setSelectedPartId} reason="loading" />}
      >
        <LazyAimScene model={model} onSelectPart={setSelectedPartId} />
      </Suspense>
      {selectedPart ? (
        <PocCard onClose={() => setSelectedPartId(null)} part={selectedPart} />
      ) : null}
    </main>
  );
}

export function AimRoute() {
  return <AimExperience />;
}
