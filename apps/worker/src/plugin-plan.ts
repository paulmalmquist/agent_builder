import type { JsonValue } from '@agent-builder/contracts';
import { PluginRuntimeError } from '@paul-os/runtime';
import type { WorkerPluginCall, WorkerPluginExecutor } from './plugin-execution.js';
import type { ClaimedRun } from './types.js';

export interface PlannedWorkerPluginCall {
  ordinal: number;
  outputContextKey: string;
  call: WorkerPluginCall;
}

export interface WorkerPluginPlanSource {
  loadPlannedCalls(run: ClaimedRun, workerId: string): Promise<readonly PlannedWorkerPluginCall[]>;
}

export interface PluginRunPlanResult {
  context: Record<string, JsonValue>;
  costUsd: number;
}

/**
 * Executes the server-materialized, immutable pre-model call plan in ordinal order. This is not a
 * model tool loop: the worker cannot invent calls, arguments, ordering, or output context keys.
 */
export class WorkerPluginPlanCoordinator {
  constructor(
    private readonly source: WorkerPluginPlanSource,
    private readonly executor: WorkerPluginExecutor,
  ) {}

  async execute(
    run: ClaimedRun,
    workerId: string,
    signal: AbortSignal,
  ): Promise<PluginRunPlanResult> {
    const planned = await this.source.loadPlannedCalls(run, workerId);
    const context: Record<string, JsonValue> = {};
    let costUsd = 0;
    let priorOrdinal = -1;
    for (const item of planned) {
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new PluginRuntimeError('PLUGIN_CALL_CANCELLED', false);
      }
      if (item.ordinal <= priorOrdinal || Object.hasOwn(context, item.outputContextKey)) {
        throw new PluginRuntimeError('PLUGIN_CALL_PLAN_INVALID', false);
      }
      priorOrdinal = item.ordinal;
      const result = await this.executor.execute({ ...item.call, signal });
      context[item.outputContextKey] = result.output;
      if (result.costUsd !== null) {
        if (!Number.isFinite(result.costUsd) || result.costUsd < 0) {
          throw new PluginRuntimeError('PLUGIN_COST_INVALID', false);
        }
        costUsd += result.costUsd;
      }
    }
    return { context, costUsd };
  }
}
