import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import type {
  AgentSpec,
  DerivationMode,
  GuardrailsSection,
  InterpretSpecRequest,
  KnowledgeSection,
  OutcomesSection,
  OutputsSection,
  SourceDescriptor,
  UpdateKnowledgeRequest,
} from '@agent-builder/contracts';
import {
  agentApi,
  ApiError,
  platformApi,
  type ApproveRunInput,
  type CatalogFilters,
  type GrantFilters,
  type ResourceFilters,
  type ReviewImprovementInput,
  type ReviewMemoryInput,
  type DeclineReleaseInput,
  type PromoteReleaseInput,
  type RunFilters,
} from './client';

type InterpretationConfirmation = NonNullable<UpdateKnowledgeRequest['interpretationConfirmation']>;

export const queryKeys = {
  agents: (query: string) => ['agents', query] as const,
  catalog: (filters: CatalogFilters) => ['agent-catalog', filters] as const,
  familyVersions: (familyId: string | null, includeRetired: boolean) =>
    ['agent-family-versions', familyId, includeRetired] as const,
  agent: (agentId: string | null) => ['agent', agentId] as const,
  sources: (role: SourceDescriptor['role']) => ['sources', role] as const,
  spec: (specId: string | null) => ['spec', specId] as const,
  generationJob: (jobId: string | null) => ['generation-job', jobId] as const,
  evaluation: (agentId: string | null) => ['evaluation', agentId] as const,
  certificationRun: (runId: string | null) => ['certification-run', runId] as const,
  certificationRuns: (agentId: string | null) => ['certification-runs', agentId] as const,
  platformResources: (filters: ResourceFilters) => ['platform-resources', filters] as const,
  attention: ['attention'] as const,
  attentionItem: (itemId: string | null) => ['attention-item', itemId] as const,
  executionRuns: (filters: RunFilters) => ['execution-runs', filters] as const,
  executionRun: (runId: string | null) => ['execution-run', runId] as const,
  authorityGrants: (filters: GrantFilters) => ['authority-grants', filters] as const,
  outcomes: (runId?: string) => ['outcomes', runId ?? 'all'] as const,
  metrics: (runId?: string) => ['metrics', runId ?? 'all'] as const,
  automationSchedules: ['automation-schedules'] as const,
  productionChannel: (channelKey: string) => ['production-channel', channelKey] as const,
  releaseEvaluation: (evaluationId: string | null) => ['release-evaluation', evaluationId] as const,
  observations: ['observations'] as const,
  improvementCandidates: ['improvement-candidates'] as const,
  memoryCandidates: ['memory-candidates'] as const,
};

export function useAttention() {
  return useQuery({
    queryKey: queryKeys.attention,
    queryFn: () => platformApi.getAttention(),
    refetchInterval: 10_000,
  });
}

export function useAttentionItem(itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.attentionItem(itemId),
    queryFn: () => platformApi.getAttentionItem(itemId ?? ''),
    enabled: itemId !== null,
  });
}

export function useResolveAttentionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, rationale }: { itemId: string; rationale: string }) =>
      platformApi.resolveAttentionItem(itemId, rationale),
    onSuccess: (_resolution, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attentionItem(variables.itemId) }),
      ]),
  });
}

export function useAgentSearch(query: string, enabled = true, retainPreviousData = true) {
  return useQuery({
    queryKey: queryKeys.agents(query),
    queryFn: () => agentApi.search(query),
    ...(retainPreviousData ? { placeholderData: keepPreviousData } : {}),
    enabled,
  });
}

export function usePlatformResources(filters: ResourceFilters) {
  return useQuery({
    queryKey: queryKeys.platformResources(filters),
    queryFn: () => platformApi.listResources(filters),
  });
}

export function useExecutionRuns(filters: RunFilters = {}) {
  return useQuery({
    queryKey: queryKeys.executionRuns(filters),
    queryFn: () => platformApi.listExecutionRuns(filters),
    refetchInterval: (query) => {
      const hasOpenWork = query.state.data?.items.some(
        (run) =>
          run.state === 'awaiting_approval' || run.state === 'queued' || run.state === 'running',
      );
      return hasOpenWork ? 2_000 : 10_000;
    },
  });
}

export function useExecutionRun(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.executionRun(runId),
    queryFn: () => platformApi.getExecutionRun(runId ?? ''),
    enabled: runId !== null,
  });
}

export function useAuthorityGrants(filters: GrantFilters = {}) {
  return useQuery({
    queryKey: queryKeys.authorityGrants(filters),
    queryFn: () => platformApi.listAuthorityGrants(filters),
    refetchInterval: 10_000,
  });
}

export function useOutcomes(runId?: string) {
  return useQuery({
    queryKey: queryKeys.outcomes(runId),
    queryFn: () => platformApi.listOutcomes(runId),
  });
}

export function useMetrics(runId?: string) {
  return useQuery({
    queryKey: queryKeys.metrics(runId),
    queryFn: () => platformApi.listMetrics(runId),
  });
}

export function useAutomationSchedules() {
  return useQuery({
    queryKey: queryKeys.automationSchedules,
    queryFn: () => platformApi.listAutomationSchedules(),
    refetchInterval: 30_000,
  });
}

export function useUpdateAutomationScheduleState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      scheduleId,
      state,
      rationale,
    }: {
      scheduleId: string;
      state: 'active' | 'paused';
      rationale: string;
    }) => platformApi.updateAutomationScheduleState(scheduleId, { state, rationale }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.automationSchedules }),
  });
}

export function useProductionChannel(channelKey: string) {
  return useQuery({
    queryKey: queryKeys.productionChannel(channelKey),
    queryFn: () => platformApi.getProductionChannel(channelKey),
  });
}

export function useReleaseEvaluation(evaluationId: string | null) {
  return useQuery({
    queryKey: queryKeys.releaseEvaluation(evaluationId),
    queryFn: () => platformApi.getReleaseEvaluation(evaluationId ?? ''),
    enabled: evaluationId !== null,
  });
}

export function useObservations() {
  return useQuery({
    queryKey: queryKeys.observations,
    queryFn: () => platformApi.listObservations(),
  });
}

export function useImprovementCandidates() {
  return useQuery({
    queryKey: queryKeys.improvementCandidates,
    queryFn: () => platformApi.listImprovementCandidates(),
  });
}

export function useReviewImprovementCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, value }: { candidateId: string; value: ReviewImprovementInput }) =>
      platformApi.reviewImprovementCandidate(candidateId, value),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.improvementCandidates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      ]),
  });
}

export function useMemoryCandidates() {
  return useQuery({
    queryKey: queryKeys.memoryCandidates,
    queryFn: () => platformApi.listMemoryCandidates(),
  });
}

export function useReviewMemoryCandidate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ candidateId, value }: { candidateId: string; value: ReviewMemoryInput }) =>
      platformApi.reviewMemoryCandidate(candidateId, value),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.memoryCandidates }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      ]),
  });
}

export function useApproveExecutionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, value }: { runId: string; value: ApproveRunInput }) =>
      platformApi.approveExecutionRun(runId, value),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['execution-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['authority-grants'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
      ]),
  });
}

export function useRejectExecutionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, rationale }: { runId: string; rationale: string }) =>
      platformApi.rejectExecutionRun(runId, rationale),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
        queryClient.invalidateQueries({ queryKey: ['execution-runs'] }),
      ]),
  });
}

export function usePromoteRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelKey, value }: { channelKey: string; value: PromoteReleaseInput }) =>
      platformApi.promoteRelease(channelKey, value),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
        queryClient.invalidateQueries({ queryKey: ['production-channel'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-resources'] }),
      ]),
  });
}

export function useDeclineRelease() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channelKey, value }: { channelKey: string; value: DeclineReleaseInput }) =>
      platformApi.declineRelease(channelKey, value),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
        queryClient.invalidateQueries({ queryKey: ['production-channel'] }),
      ]),
  });
}

export function useCancelExecutionRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => platformApi.cancelExecutionRun(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['execution-runs'] }),
  });
}

export function useRevokeAuthorityGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => platformApi.revokeAuthorityGrant(grantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['authority-grants'] }),
  });
}

export function useAgentCatalog(filters: CatalogFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.catalog(filters),
    queryFn: ({ pageParam }) =>
      agentApi.listCatalog({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useFamilyVersions(familyId: string | null, includeRetired = true) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.familyVersions(familyId, includeRetired),
    queryFn: ({ pageParam }) =>
      agentApi.listFamilyVersions(familyId ?? '', includeRetired, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: familyId !== null,
  });
  const data = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.[0]) return undefined;
    return {
      ...pages[0],
      items: pages.flatMap((page) => page.items),
      nextCursor: pages.at(-1)?.nextCursor ?? null,
    };
  }, [query.data?.pages]);
  return { ...query, data };
}

export function useAgentDetail(agentId: string | null) {
  return useQuery({
    queryKey: queryKeys.agent(agentId),
    queryFn: () => agentApi.getAgent(agentId ?? ''),
    enabled: agentId !== null,
  });
}

export function useSourceCatalog(role: SourceDescriptor['role'], enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sources(role),
    queryFn: () => agentApi.listSources(role),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAgentSpec(specId: string | null) {
  return useQuery({
    queryKey: queryKeys.spec(specId),
    queryFn: () => agentApi.getSpec(specId ?? ''),
    enabled: specId !== null,
  });
}

export function useCreateSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      outcomes,
      baseAgentId,
      derivationMode,
      interpretationId,
    }: {
      outcomes: OutcomesSection;
      baseAgentId: string | null;
      derivationMode: DerivationMode;
      interpretationId: string | null;
    }) => agentApi.createSpec(outcomes, baseAgentId, derivationMode, interpretationId),
    onSuccess: (spec) => {
      queryClient.setQueryData(queryKeys.spec(spec.id), spec);
    },
  });
}

type SectionUpdate =
  | { section: 'outcomes'; value: OutcomesSection; confirmation?: InterpretationConfirmation }
  | { section: 'knowledge'; value: KnowledgeSection; confirmation?: InterpretationConfirmation }
  | { section: 'guardrails'; value: GuardrailsSection; confirmation?: InterpretationConfirmation }
  | { section: 'outputs'; value: OutputsSection; confirmation?: InterpretationConfirmation };

export function useUpdateSpecSection(specId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (update: SectionUpdate) => {
      if (!specId) throw new Error('Create the specification before editing this section.');

      switch (update.section) {
        case 'outcomes':
          return agentApi.updateOutcomes(specId, update.value, update.confirmation);
        case 'knowledge':
          return agentApi.updateKnowledge(specId, update.value, update.confirmation);
        case 'guardrails':
          return agentApi.updateGuardrails(specId, update.value, update.confirmation);
        case 'outputs':
          return agentApi.updateOutputs(specId, update.value, update.confirmation);
      }
    },
    onSuccess: (spec: AgentSpec) => {
      queryClient.setQueryData(queryKeys.spec(spec.id), spec);
    },
  });
}

export function useInterpretSpec() {
  return useMutation({
    mutationFn: (value: InterpretSpecRequest) => agentApi.interpretSpec(value),
  });
}

export function useGenerationJob(jobId: string | null) {
  return useQuery({
    queryKey: queryKeys.generationJob(jobId),
    queryFn: () => agentApi.getGenerationJob(jobId ?? ''),
    enabled: jobId !== null,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 404) return false;
      return failureCount < 3;
    },
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;

      const job = query.state.data;
      if (!job || job.state === 'queued' || job.state === 'running') {
        const progress = job?.progress ?? 0;
        return Math.min(1_000 + Math.floor(progress / 20) * 500, 3_500);
      }
      return false;
    },
  });
}

export function useEvaluation(agentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.evaluation(agentId),
    queryFn: () => agentApi.getEvaluation(agentId ?? ''),
    enabled: enabled && agentId !== null,
    refetchInterval: (query) => {
      if (query.state.status === 'error' || query.state.data?.status === 'complete') {
        return false;
      }
      return 2_000;
    },
  });
}

export function useCertificationRun(runId: string | null) {
  const queryClient = useQueryClient();
  const invalidatedTerminalRuns = useRef(new Set<string>());
  const query = useInfiniteQuery({
    queryKey: queryKeys.certificationRun(runId),
    queryFn: ({ pageParam }) => agentApi.getCertificationRun(runId ?? '', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.results.nextCursor ?? undefined,
    enabled: runId !== null,
    refetchInterval: (query) => {
      const state = query.state.data?.pages[0]?.run.state;
      return state === 'queued' || state === 'running' ? 1_500 : false;
    },
  });
  const data = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.[0]) return undefined;
    return {
      ...pages[0],
      results: {
        items: pages.flatMap((page) => page.results.items),
        nextCursor: pages.at(-1)?.results.nextCursor ?? null,
      },
    };
  }, [query.data?.pages]);

  const state = data?.run.state;
  useEffect(() => {
    const run = data?.run;
    if (!run || state === 'queued' || state === 'running') return;
    if (invalidatedTerminalRuns.current.has(run.id)) return;
    invalidatedTerminalRuns.current.add(run.id);
    void queryClient.invalidateQueries({
      queryKey: queryKeys.certificationRuns(run.agentVersionId),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.agent(run.agentVersionId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.familyVersions(run.familyId, true) });
    void queryClient.invalidateQueries({ queryKey: ['agent-catalog'] });
  }, [data?.run, queryClient, state]);

  return { ...query, data };
}

export function useCertificationHistory(agentId: string | null) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.certificationRuns(agentId),
    queryFn: ({ pageParam }) => agentApi.listCertificationRuns(agentId ?? '', pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: agentId !== null,
  });
  const data = useMemo(() => {
    const pages = query.data?.pages;
    if (!pages?.[0]) return undefined;
    return {
      items: pages.flatMap((page) => page.items),
      nextCursor: pages.at(-1)?.nextCursor ?? null,
    };
  }, [query.data?.pages]);
  return { ...query, data };
}

export function useStartCertification(agentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!agentId) throw new Error('Select an agent version before starting certification.');
      return agentApi.createCertificationRun(agentId);
    },
    onSuccess: (accepted) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.certificationRuns(agentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentId) });
      return accepted;
    },
  });
}

export function usePromoteAgent(agentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, rationale }: { runId: string; rationale: string }) => {
      if (!agentId) throw new Error('Select an agent version before promotion.');
      return agentApi.promote(agentId, { runId, rationale });
    },
    onSuccess: (_decision, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(agentId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.certificationRuns(agentId) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.certificationRun(variables.runId),
      });
      void queryClient.invalidateQueries({ queryKey: ['agent-family-versions'] });
      void queryClient.invalidateQueries({ queryKey: ['agent-catalog'] });
    },
  });
}
