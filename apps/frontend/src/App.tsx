import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type {
  GuardrailsSection,
  InterpretationConfirmation,
  InterpretationResolution,
  InterpretSpecResponse,
  KnowledgeSection,
  OutcomesSection,
  OutputsSection,
  CapabilityProfile,
} from '@agent-builder/contracts';
import {
  useAgentSpec,
  useBuilderReferredChoices,
  useCreateBuilderDecision,
  useCreateBuilderIntake,
  useCreateSpec,
  useEvaluation,
  useGenerationJob,
  useInterpretSpec,
  useSourceCatalog,
  useUpdateSpecSection,
  queryKeys,
} from './api/hooks';
import { builderApi, getErrorMessage } from './api/client';
import { GovernanceBar } from './components/GovernanceBar';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { Notice } from './components/Notice';
import { WorkflowStep, type WorkflowStepId } from './components/WorkflowStep';
import { BlueprintSection } from './features/blueprint/BlueprintSection';
import { GenerationPanel } from './features/generation/GenerationPanel';
import { ReviewDialog } from './features/generation/ReviewDialog';
import { GuardrailsForm } from './features/spec/GuardrailsForm';
import { KnowledgeForm } from './features/spec/KnowledgeForm';
import { OutputsForm } from './features/spec/OutputsForm';
import { ScopeForm } from './features/spec/ScopeForm';
import { InputModeToggle } from './features/single-shot/InputModeToggle';
import { SingleShotPanel } from './features/single-shot/SingleShotPanel';
import {
  ReferredChoicesPanel,
  type PendingBuilderDecision,
} from './features/builder/ReferredChoicesPanel';
import { ReuseDecisionDialog } from './features/builder/ReuseDecisionDialog';

type DialogId = 'scope' | 'knowledge' | 'guardrails' | 'outputs' | 'review' | 'process';
type PendingDecision = PendingBuilderDecision & { idempotencyKey: string };

const workflowSteps = [
  {
    step: 1 as const,
    title: 'DEFINE SCOPE & PURPOSE',
    description: 'Describe the job to be done, inputs, users, and the desired outcome.',
    icon: 'scope' as const,
  },
  {
    step: 2 as const,
    title: 'DEFINE KNOWLEDGE & ACCESS',
    description: 'Select and configure governed data sources, documents, and tools.',
    icon: 'database' as const,
  },
  {
    step: 3 as const,
    title: 'DEFINE ACTIONS & WORKFLOW',
    description: 'Choose the auditable workflow, approvals, and fail-closed behavior.',
    icon: 'code' as const,
  },
  {
    step: 4 as const,
    title: 'DEFINE SUCCESS CRITERIA',
    description: 'Set evaluation criteria, quality thresholds, and acceptance tests.',
    icon: 'success' as const,
  },
];

type StepState = Record<WorkflowStepId, boolean>;

const precedingStep: Record<Exclude<WorkflowStepId, 1>, WorkflowStepId> = {
  2: 1,
  3: 2,
  4: 3,
};

function intakeProfile(outcomes: OutcomesSection): CapabilityProfile {
  return {
    schemaVersion: 1,
    intendedUsers: [outcomes.audience],
    businessDomain: outcomes.department,
    triggers: ['User-requested build intake'],
    tasks: [outcomes.purpose],
    inputs: ['User-provided scope'],
    outputs: outcomes.desiredOutcomes,
    knowledgeClasses: [],
    tools: [],
    potentialActions: [],
    successCriteria: outcomes.desiredOutcomes,
    riskLevel: 'moderate',
  };
}

export function App() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const inputMode = searchParams.get('mode') === 'single-shot' ? 'single-shot' : 'guided';
  const [dialog, setDialog] = useState<DialogId | null>(null);
  const [pendingOutcomes, setPendingOutcomes] = useState<OutcomesSection | null>(null);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modeWarning, setModeWarning] = useState<string | null>(null);
  const [singleShotPrompt, setSingleShotPrompt] = useState('');
  const [interpretation, setInterpretation] = useState<InterpretSpecResponse | null>(null);
  const [reviewedInterpretationId, setReviewedInterpretationId] = useState<string | null>(null);
  const [interpretationResolutions, setInterpretationResolutions] = useState<
    Partial<Record<string, InterpretationResolution>>
  >({});
  const [justUnlockedSteps, setJustUnlockedSteps] = useState<Set<WorkflowStepId>>(() => new Set());
  const [justCompletedSteps, setJustCompletedSteps] = useState<Set<WorkflowStepId>>(
    () => new Set(),
  );
  const previousCompletedSteps = useRef<StepState | null>(null);
  const previousUnlockedSteps = useRef<StepState | null>(null);
  const specId = searchParams.get('spec');
  const intakeId = searchParams.get('intake');
  const jobId = searchParams.get('job');
  const shadowDeployed = searchParams.get('shadow') === 'true';

  function setUrlState(key: 'spec' | 'job' | 'shadow', value: string | null) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    });
  }

  const setJobId = (value: string | null) => setUrlState('job', value);
  const setShadowDeployed = (value: boolean) => setUrlState('shadow', value ? 'true' : null);

  const createIntake = useCreateBuilderIntake();
  const referredChoices = useBuilderReferredChoices(intakeId);
  const createDecision = useCreateBuilderDecision(intakeId);
  const specQuery = useAgentSpec(specId);
  const spec = specQuery.data;
  const sourceCatalog = useSourceCatalog('knowledge', dialog === 'knowledge');
  const createSpec = useCreateSpec();
  const confirmCreatedOutcomes = useMutation({
    mutationFn: ({
      createdSpecId,
      outcomes,
      confirmation,
    }: {
      createdSpecId: string;
      outcomes: OutcomesSection;
      confirmation: InterpretationConfirmation;
    }) => builderApi.updateOutcomes(createdSpecId, outcomes, confirmation),
    onSuccess: (confirmedSpec) => {
      queryClient.setQueryData(queryKeys.spec(confirmedSpec.id), confirmedSpec);
    },
  });
  const updateSection = useUpdateSpecSection(specId);
  const jobQuery = useGenerationJob(jobId);
  const evaluation = useEvaluation(jobQuery.data?.agentId ?? null, shadowDeployed);
  const interpretSpec = useInterpretSpec();

  const generate = useMutation({
    mutationFn: (id: string) => builderApi.generate(id),
    onSuccess: (accepted) => {
      setJobId(accepted.jobId);
      setDialog(null);
      setNotice('Generation queued. Progress will update automatically.');
    },
  });

  const recover = useMutation({
    mutationFn: (agentId: string) => builderApi.recover(agentId),
    onSuccess: async () => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('job');
        next.delete('shadow');
        return next;
      });
      setNotice('The agent is back in draft and the ready specification can be generated again.');
      await queryClient.invalidateQueries({ queryKey: queryKeys.spec(specId) });
    },
  });

  const shadowDeploy = useMutation({
    mutationFn: (agentId: string) => builderApi.shadowDeploy(agentId),
    onSuccess: async (deployment) => {
      setShadowDeployed(true);
      setNotice(`Shadow deployment ${deployment.deploymentId} started.`);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.evaluation(deployment.agentId),
      });
    },
  });

  const completion = spec?.completion ?? {
    outcomes: false,
    knowledge: false,
    guardrails: false,
    outputs: false,
  };
  const allComplete =
    completion.outcomes && completion.knowledge && completion.guardrails && completion.outputs;
  const canReview = allComplete && spec?.status === 'ready' && jobId === null;
  const completedSteps: StepState = {
    1: completion.outcomes,
    2: completion.knowledge,
    3: completion.guardrails,
    4: completion.outputs,
  };
  const unlockedSteps: StepState = {
    1: true,
    2: completion.outcomes,
    3: completion.knowledge,
    4: completion.guardrails,
  };
  const nextActionableStep =
    workflowSteps.find((step) => unlockedSteps[step.step] && !completedSteps[step.step])?.step ??
    null;
  const furthestCompletedStep = workflowSteps.reduce<number>(
    (furthest, step) => (completedSteps[step.step] ? Math.max(furthest, step.step) : furthest),
    0,
  );
  const railProgress =
    furthestCompletedStep === 0
      ? 0
      : furthestCompletedStep === 1
        ? 33
        : furthestCompletedStep === 2
          ? 66
          : 100;

  useEffect(() => {
    const nextCompletedSteps: StepState = {
      1: completion.outcomes,
      2: completion.knowledge,
      3: completion.guardrails,
      4: completion.outputs,
    };
    const nextUnlockedSteps: StepState = {
      1: true,
      2: completion.outcomes,
      3: completion.knowledge,
      4: completion.guardrails,
    };
    const previousCompleted = previousCompletedSteps.current;
    const previousUnlocked = previousUnlockedSteps.current;

    if (previousCompleted && previousUnlocked) {
      const newlyCompleted = workflowSteps
        .map((step) => step.step)
        .filter((step) => !previousCompleted[step] && nextCompletedSteps[step]);
      const newlyUnlocked = workflowSteps
        .map((step) => step.step)
        .filter((step) => !previousUnlocked[step] && nextUnlockedSteps[step]);

      if (newlyCompleted.length > 0) {
        setJustCompletedSteps((current) => new Set([...current, ...newlyCompleted]));
      }
      if (newlyUnlocked.length > 0) {
        setJustUnlockedSteps((current) => new Set([...current, ...newlyUnlocked]));
      }
    }

    previousCompletedSteps.current = nextCompletedSteps;
    previousUnlockedSteps.current = nextUnlockedSteps;
  }, [completion.guardrails, completion.knowledge, completion.outcomes, completion.outputs]);

  useEffect(() => {
    if (justCompletedSteps.size === 0 && justUnlockedSteps.size === 0) return;
    const cleanupMotionState = window.setTimeout(() => {
      setJustCompletedSteps(new Set());
      setJustUnlockedSteps(new Set());
    }, 1_000);
    return () => window.clearTimeout(cleanupMotionState);
  }, [justCompletedSteps, justUnlockedSteps]);

  const actionError =
    createIntake.error ??
    referredChoices.error ??
    createSpec.error ??
    confirmCreatedOutcomes.error ??
    updateSection.error ??
    specQuery.error ??
    generate.error ??
    recover.error ??
    shadowDeploy.error ??
    interpretSpec.error ??
    null;

  const interpretedPrefill = interpretation?.kind === 'prefill' ? interpretation : null;
  const highestMatchScore =
    referredChoices.data?.referredChoices.reduce(
      (highest, choice) => Math.max(highest, choice.match.score),
      0,
    ) ?? null;

  function setInputMode(mode: 'guided' | 'single-shot') {
    if (mode === 'single-shot' && spec && Object.values(spec.completion).some(Boolean)) {
      const protectedSections = Object.entries(spec.completion)
        .filter(([, complete]) => complete)
        .map(([section]) => section)
        .join(', ');
      setModeWarning(
        `Protected confirmed sections: ${protectedSections}. Interpretation may only fill empty sections and cannot overwrite these values.`,
      );
    } else {
      setModeWarning(null);
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (mode === 'single-shot') next.set('mode', 'single-shot');
      else next.delete('mode');
      return next;
    });
  }

  function submitIntake(outcomes: OutcomesSection, confirmed: boolean) {
    createIntake.mutate(
      {
        request: outcomes.purpose,
        department: outcomes.department,
        capabilityProfile: intakeProfile(outcomes),
        confirmed,
      },
      {
        onSuccess: (intake) => {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set('intake', intake.id);
            next.delete('candidate');
            next.delete('intent');
            return next;
          });
          setNotice(
            confirmed
              ? 'Referred choices are ready. Choose reuse, adaptation, or a new draft.'
              : 'Interpretation ready. Review the scope before choosing an implementation.',
          );
        },
      },
    );
  }

  function acceptInterpretation(result: InterpretSpecResponse) {
    setInterpretation(result);
    setReviewedInterpretationId(null);
    setInterpretationResolutions({});
    if (result.kind !== 'prefill') {
      setNotice('Choose one scope before the interpreter prepares a governed specification.');
      return;
    }

    if (result.sections.outcomes.value) {
      if (!spec?.completion.outcomes) {
        setPendingOutcomes(result.sections.outcomes.value);
      }
      submitIntake(result.sections.outcomes.value, false);
    } else {
      setNotice('The scope is unresolved. Review step 01 before creating a draft.');
    }
  }

  function interpretPrompt() {
    interpretSpec.mutate(
      {
        kind: 'prompt',
        prompt: singleShotPrompt,
        ...(specId ? { specId } : {}),
      },
      { onSuccess: acceptInterpretation },
    );
  }

  function interpretSplit(candidate: string) {
    if (!interpretation) return;
    interpretSpec.mutate(
      {
        kind: 'split_selection',
        parentInterpretationId: interpretation.interpretationId,
        candidateId: candidate,
        ...(specId ? { specId } : {}),
      },
      { onSuccess: acceptInterpretation },
    );
  }

  function sectionConfirmation(
    section: 'outcomes' | 'knowledge' | 'guardrails' | 'outputs',
  ): InterpretationConfirmation | undefined {
    if (!interpretedPrefill) return undefined;
    const unresolvedItems = interpretedPrefill.sections[section].unresolved;
    const resolutions = unresolvedItems.flatMap((item) => {
      const resolution = interpretationResolutions[item.id];
      return resolution ? [resolution] : [];
    });
    if (resolutions.length !== unresolvedItems.length) return undefined;
    return {
      interpretationId: interpretedPrefill.interpretationId,
      resolutions,
    };
  }

  function canConfirmInterpretationSection(
    section: 'outcomes' | 'knowledge' | 'guardrails' | 'outputs',
  ) {
    return (
      !interpretedPrefill ||
      interpretedPrefill.sections[section].unresolved.every((item) => {
        const resolution = interpretationResolutions[item.id];
        return (
          resolution?.unresolvedId === item.id &&
          (resolution.action !== 'acknowledge' || resolution.rationale.trim().length >= 3)
        );
      })
    );
  }

  function setInterpretationResolution(
    itemId: string,
    resolution: InterpretationResolution | null,
  ) {
    setInterpretationResolutions((current) => {
      const next = { ...current };
      if (resolution) next[itemId] = resolution;
      else delete next[itemId];
      return next;
    });
  }

  function openStep(step: WorkflowStepId) {
    if (step === 1) {
      setDialog('scope');
      return;
    }
    if (!unlockedSteps[step]) {
      const predecessor = precedingStep[step];
      setNotice(`Complete step ${String(predecessor).padStart(2, '0')} first.`);
      return;
    }
    if (!spec) return;
    if (spec.status === 'generating' || spec.status === 'generated') {
      setNotice('This revision is locked because generation has started.');
      return;
    }
    setDialog(step === 2 ? 'knowledge' : step === 3 ? 'guardrails' : 'outputs');
  }

  function searchScope(outcomes: OutcomesSection) {
    if (!canConfirmInterpretationSection('outcomes')) {
      setNotice('Resolve every interpreted scope uncertainty before saving this section.');
      return;
    }
    setPendingOutcomes(outcomes);
    submitIntake(outcomes, true);
    if (interpretedPrefill) {
      setReviewedInterpretationId(interpretedPrefill.interpretationId);
    }

    if (specId) {
      const confirmation = sectionConfirmation('outcomes');
      updateSection.mutate(
        { section: 'outcomes', value: outcomes, ...(confirmation ? { confirmation } : {}) },
        {
          onSuccess: () => {
            setDialog(null);
            setNotice('Scope updated. Referred choices are being refreshed.');
          },
        },
      );
    } else {
      setDialog(null);
    }
  }

  function createDraft(baseAgentId: string | null, mode: 'extend' | 'new') {
    const outcomes = pendingOutcomes ?? spec?.outcomes;
    if (!outcomes) {
      setPendingDecision(null);
      setDialog('scope');
      setNotice('Define the scope before choosing an implementation path.');
      return;
    }
    if (interpretedPrefill && reviewedInterpretationId !== interpretedPrefill.interpretationId) {
      setPendingDecision(null);
      setDialog('scope');
      setNotice('Review and save the interpreted scope before creating a draft.');
      return;
    }
    if (spec) {
      setPendingDecision(null);
      setNotice('A draft already exists. Finish or recover it before creating another.');
      return;
    }

    createSpec.mutate(
      {
        outcomes,
        baseAgentId: mode === 'new' ? null : baseAgentId,
        derivationMode: mode,
        interpretationId: interpretedPrefill?.interpretationId ?? null,
      },
      {
        onSuccess: (created) => {
          setPendingDecision(null);
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set('spec', created.id);
            next.delete('candidate');
            next.delete('intent');
            return next;
          });
          const createdMessage =
            mode === 'new'
              ? 'New draft created. Continue with governed knowledge.'
              : 'Extension draft created with recorded source lineage.';
          const outcomesConfirmation = sectionConfirmation('outcomes');
          if (interpretedPrefill && outcomesConfirmation) {
            setNotice('Draft created. Recording the reviewed scope and interpretation lineage…');
            confirmCreatedOutcomes.mutate(
              {
                createdSpecId: created.id,
                outcomes,
                confirmation: outcomesConfirmation,
              },
              { onSuccess: () => setNotice(createdMessage) },
            );
          } else {
            setNotice(createdMessage);
          }
        },
      },
    );
  }

  function submitDecision(reason: string | null) {
    if (!pendingDecision) return;
    if (interpretedPrefill && reviewedInterpretationId !== interpretedPrefill.interpretationId) {
      setPendingDecision(null);
      setDialog('scope');
      setNotice('Review and save the interpreted scope before choosing an implementation.');
      return;
    }
    const decision = pendingDecision;
    createDecision.mutate(
      {
        idempotencyKey: decision.idempotencyKey,
        value: {
          action: decision.action,
          selectedPublicationId: decision.choice?.publicationId ?? null,
          buildNewReason: reason,
        },
      },
      {
        onSuccess: () => {
          if (decision.action === 'use_as_is' && decision.choice) {
            setPendingDecision(null);
            setNotice(`Deployment created from ${decision.choice.name}. No draft was created.`);
            return;
          }
          if (decision.action === 'configure' && decision.choice) {
            setPendingDecision(null);
            setNotice(
              `Configuration overlay created for ${decision.choice.name}. The certified agent was not forked.`,
            );
            return;
          }
          if (decision.action === 'extend' && decision.choice) {
            createDraft(decision.choice.provenance.resourceVersionId, 'extend');
            return;
          }
          createDraft(null, 'new');
        },
      },
    );
  }

  function beginDecision(decision: PendingBuilderDecision) {
    setPendingDecision({ ...decision, idempotencyKey: crypto.randomUUID() });
  }

  function saveSection(
    update:
      | { section: 'knowledge'; value: KnowledgeSection }
      | { section: 'guardrails'; value: GuardrailsSection }
      | { section: 'outputs'; value: OutputsSection },
  ) {
    if (!canConfirmInterpretationSection(update.section)) {
      setNotice(`Resolve every interpreted ${update.section} uncertainty before saving.`);
      return;
    }
    const confirmation = sectionConfirmation(update.section);
    updateSection.mutate(
      { ...update, ...(confirmation ? { confirmation } : {}) },
      {
        onSuccess: () => {
          setDialog(null);
          setNotice(`${update.section[0]?.toUpperCase()}${update.section.slice(1)} saved.`);
        },
      },
    );
  }

  const generationError =
    jobQuery.isError || shadowDeploy.isError || recover.isError || evaluation.isError
      ? getErrorMessage(jobQuery.error ?? shadowDeploy.error ?? recover.error ?? evaluation.error)
      : null;

  return (
    <main className="page-shell">
      <div className="frame">
        <section className="left-column">
          <div className="hero-copy">
            <h1>
              <span className="hero-line">Build or extend the right agent.</span>
              <br />
              <span className="hero-line">Faster. Governed. Effective.</span>
            </h1>
            <div aria-hidden="true" className="hairline" />
            <p>
              Describe what you want to accomplish.
              <br className="desktop-break" /> We’ll help you reuse what exists or guide
              <br className="desktop-break" /> you to build the right agent step by step.
            </p>
          </div>
          {notice ? (
            <div className="dismissible-notice">
              <Notice tone="success">{notice}</Notice>
              <button
                aria-label="Dismiss notification"
                className="notice-dismiss"
                onClick={() => setNotice(null)}
                type="button"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ) : null}
          {modeWarning ? <Notice>{modeWarning}</Notice> : null}
          {actionError ? <Notice tone="error">{getErrorMessage(actionError)}</Notice> : null}
          {referredChoices.data?.referredChoices[0] ? (
            <div className="similarity-note">
              <Icon name="draft" size={18} />
              Closest certified match:{' '}
              {Math.round(referredChoices.data.referredChoices[0].match.score)}%{' · '}
              {referredChoices.data.referredChoices[0].match.label}
            </div>
          ) : null}
          <ReferredChoicesPanel
            intakeId={intakeId}
            isLoading={
              createIntake.isPending || referredChoices.isLoading || referredChoices.isFetching
            }
            onChoose={beginDecision}
            results={referredChoices.data}
          />
        </section>

        <section aria-label="Agent specification workflow" className="workflow-column">
          <InputModeToggle mode={inputMode} onChange={setInputMode} />
          {inputMode === 'single-shot' ? (
            <SingleShotPanel
              error={interpretSpec.isError ? getErrorMessage(interpretSpec.error) : null}
              interpretation={interpretation}
              isInterpreting={interpretSpec.isPending}
              onInterpret={interpretPrompt}
              onPromptChange={setSingleShotPrompt}
              onReviewStep={openStep}
              onSelectSplit={interpretSplit}
              onSwitchGuided={() => setInputMode('guided')}
              prompt={singleShotPrompt}
            />
          ) : null}
          <div className="workflow-sequence">
            <div aria-hidden="true" className="workflow-line" data-progress={String(railProgress)}>
              <span className="workflow-line-fill" />
            </div>
            {workflowSteps.map((step) => (
              <WorkflowStep
                active={
                  dialog ===
                  (step.step === 1
                    ? 'scope'
                    : step.step === 2
                      ? 'knowledge'
                      : step.step === 3
                        ? 'guardrails'
                        : 'outputs')
                }
                complete={completedSteps[step.step]}
                description={step.description}
                icon={step.icon}
                justCompleted={justCompletedSteps.has(step.step)}
                justUnlocked={justUnlockedSteps.has(step.step)}
                key={step.step}
                locked={!unlockedSteps[step.step]}
                lockedByStep={step.step === 1 ? null : precedingStep[step.step]}
                nextActionable={nextActionableStep === step.step}
                onMotionEnd={(motionStep, motion) => {
                  if (motion === 'unlock') {
                    setJustUnlockedSteps((current) => {
                      const next = new Set(current);
                      next.delete(motionStep);
                      return next;
                    });
                    return;
                  }
                  setJustCompletedSteps((current) => {
                    const next = new Set(current);
                    next.delete(motionStep);
                    return next;
                  });
                }}
                onOpen={openStep}
                step={step.step}
                title={step.title}
              />
            ))}
            {canReview ? (
              <button className="review-button" onClick={() => setDialog('review')} type="button">
                <Icon name="draft" />
                <span>
                  <strong>Review & Generate</strong>
                  All four sections are valid for revision {spec.revision}.
                </span>
                <Icon name="arrow" />
              </button>
            ) : null}
            {jobId ? (
              <GenerationPanel
                error={generationError}
                evaluation={evaluation.data}
                isLoading={jobQuery.isLoading}
                isRecovering={recover.isPending}
                isShadowDeploying={shadowDeploy.isPending}
                job={jobQuery.data}
                onRecover={() => {
                  if (jobQuery.data) recover.mutate(jobQuery.data.agentId);
                }}
                onShadowDeploy={() => {
                  if (jobQuery.data) shadowDeploy.mutate(jobQuery.data.agentId);
                }}
                shadowDeployed={shadowDeployed}
              />
            ) : null}
          </div>
        </section>

        <GovernanceBar onExplain={() => setDialog('process')} />
        <div aria-hidden="true" className="bottom-rule" />
      </div>

      <BlueprintSection job={jobQuery.data} shadowDeployed={shadowDeployed} spec={spec} />

      {dialog === 'scope' ? (
        <ScopeForm
          initialValue={spec?.outcomes ?? pendingOutcomes ?? null}
          isSaving={createIntake.isPending || updateSection.isPending}
          onClose={() => setDialog(null)}
          onResolutionChange={setInterpretationResolution}
          onSubmit={searchScope}
          resolutions={interpretationResolutions}
          submitLabel={spec ? 'Update scope & search again' : 'Find reusable agents'}
          unresolvedItems={interpretedPrefill?.sections.outcomes.unresolved ?? []}
        />
      ) : null}
      {dialog === 'knowledge' && spec ? (
        <KnowledgeForm
          initialValue={
            spec.knowledge ??
            interpretedPrefill?.sections.knowledge.value ??
            spec.unconfirmedPrefill?.knowledge ??
            null
          }
          isLoading={sourceCatalog.isLoading}
          isSaving={updateSection.isPending}
          loadError={sourceCatalog.isError ? getErrorMessage(sourceCatalog.error) : null}
          onClose={() => setDialog(null)}
          onResolutionChange={setInterpretationResolution}
          onSubmit={(value) => saveSection({ section: 'knowledge', value })}
          resolutions={interpretationResolutions}
          sources={sourceCatalog.data?.items ?? []}
          unresolvedItems={interpretedPrefill?.sections.knowledge.unresolved ?? []}
        />
      ) : null}
      {dialog === 'guardrails' && spec ? (
        <GuardrailsForm
          initialValue={
            spec.guardrails ??
            interpretedPrefill?.sections.guardrails.value ??
            spec.unconfirmedPrefill?.guardrails ??
            null
          }
          isSaving={updateSection.isPending}
          onClose={() => setDialog(null)}
          onResolutionChange={setInterpretationResolution}
          onSubmit={(value) => saveSection({ section: 'guardrails', value })}
          resolutions={interpretationResolutions}
          unresolvedItems={interpretedPrefill?.sections.guardrails.unresolved ?? []}
        />
      ) : null}
      {dialog === 'outputs' && spec ? (
        <OutputsForm
          initialValue={
            spec.outputs ??
            interpretedPrefill?.sections.outputs.value ??
            spec.unconfirmedPrefill?.outputs ??
            null
          }
          isSaving={updateSection.isPending}
          onClose={() => setDialog(null)}
          onResolutionChange={setInterpretationResolution}
          onSubmit={(value) => saveSection({ section: 'outputs', value })}
          resolutions={interpretationResolutions}
          unresolvedItems={interpretedPrefill?.sections.outputs.unresolved ?? []}
        />
      ) : null}
      {dialog === 'review' && spec && allComplete ? (
        <ReviewDialog
          error={generate.isError ? getErrorMessage(generate.error) : null}
          isGenerating={generate.isPending}
          onClose={() => setDialog(null)}
          onGenerate={() => generate.mutate(spec.id)}
          spec={spec}
        />
      ) : null}
      {dialog === 'process' ? (
        <Modal
          kicker="Guided workflow"
          onClose={() => setDialog(null)}
          title="From intent to governed agent"
        >
          <ol className="process-list">
            <li>
              <strong>Scope before code.</strong>
              <span>Search the catalog and compare reusable agents.</span>
            </li>
            <li>
              <strong>Bind governed context.</strong>
              <span>Select descriptors without exposing credentials or identifiers.</span>
            </li>
            <li>
              <strong>Make boundaries explicit.</strong>
              <span>Define workflows, approvals, and fail-closed conditions.</span>
            </li>
            <li>
              <strong>Prove the result.</strong>
              <span>Generate a versioned manifest, then evaluate it in shadow mode.</span>
            </li>
          </ol>
        </Modal>
      ) : null}
      {pendingDecision ? (
        <ReuseDecisionDialog
          decision={pendingDecision}
          error={createDecision.isError ? getErrorMessage(createDecision.error) : null}
          highestMatchScore={highestMatchScore}
          isSubmitting={
            createDecision.isPending || createSpec.isPending || confirmCreatedOutcomes.isPending
          }
          onClose={() => {
            createDecision.reset();
            setPendingDecision(null);
          }}
          onSubmit={submitDecision}
        />
      ) : null}
    </main>
  );
}
