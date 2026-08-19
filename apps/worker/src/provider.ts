import {
  AnthropicModelProvider,
  DeterministicDailyBriefProvider,
  type ModelProvider,
} from '@paul-os/runtime';
import type { WorkerConfig } from './config.js';

export function createModelProvider(config: WorkerConfig): ModelProvider {
  if (config.provider.policy === 'gateway_only') {
    throw new Error('GATEWAY_PROVIDER_UNAVAILABLE');
  }
  if (config.provider.kind === 'deterministic') return new DeterministicDailyBriefProvider();
  if (config.provider.kind === 'anthropic') {
    if (config.provider.apiKey === undefined) throw new Error('ANTHROPIC_API_KEY_REQUIRED');
    return new AnthropicModelProvider({
      apiKey: config.provider.apiKey,
      model: config.provider.model,
    });
  }
  throw new Error('GATEWAY_PROVIDER_UNAVAILABLE');
}
