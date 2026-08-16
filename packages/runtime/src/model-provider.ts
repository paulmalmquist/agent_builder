import type { DailyBriefInput, DailyBriefOutput, JsonValue } from '@agent-builder/contracts';

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ModelStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'usage'; usage: ModelUsage }
  | { type: 'complete'; stopReason: string };

export interface ModelRequest {
  system: string;
  input: JsonValue;
  /** Ephemeral, provenance-bound context. Providers must never log or persist this value. */
  context: JsonValue;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface ModelProvider {
  readonly kind: 'deterministic' | 'anthropic' | 'gateway';
  readonly version: string;
  readonly model: string;
  stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export async function collectModelStream(
  provider: ModelProvider,
  request: ModelRequest,
  signal?: AbortSignal,
): Promise<{ text: string; usage: ModelUsage; stopReason: string }> {
  let text = '';
  let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  let stopReason = 'end_turn';
  for await (const event of provider.stream(request, signal)) {
    if (event.type === 'text_delta') text += event.text;
    if (event.type === 'usage') usage = event.usage;
    if (event.type === 'complete') stopReason = event.stopReason;
  }
  return { text, usage, stopReason };
}

export class DeterministicDailyBriefProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    const input = request.input as unknown as DailyBriefInput;
    const collisions = input.calendarItems.filter((item, index, items) =>
      items.some(
        (other, otherIndex) =>
          otherIndex !== index && item.startsAt < other.endsAt && item.endsAt > other.startsAt,
      ),
    );
    const output: DailyBriefOutput = {
      topPriorities: input.priorities.slice(0, 3),
      scheduleRisks: [...new Set(collisions.map((item) => `Schedule overlap: ${item.title}`))],
      decisionsRequired: input.signals.slice(0, 3).map((signal) => `Review signal: ${signal}`),
      proposedActions: input.tasks.slice(0, 5),
      citations: input.calendarItems.slice(0, 5).map((item) => `calendar:${item.startsAt}`),
      confidence: input.signals.length === 0 ? 0.75 : 0.9,
      unresolvedItems: input.userConstraints.filter((constraint) => constraint.includes('?')),
    };
    const text = JSON.stringify(output);
    yield { type: 'text_delta', text };
    yield {
      type: 'usage',
      usage: {
        inputTokens: Math.max(
          1,
          Math.ceil(JSON.stringify({ input, context: request.context }).length / 4),
        ),
        outputTokens: Math.max(1, Math.ceil(text.length / 4)),
      },
    };
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

type AnthropicEvent = {
  type?: string;
  message?: { usage?: { input_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
};

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  version?: string;
  endpoint?: string;
}

export class AnthropicModelProvider implements ModelProvider {
  readonly kind = 'anthropic' as const;
  readonly version: string;
  readonly model: string;
  readonly #apiKey: string;
  readonly #endpoint: string;

  constructor(options: AnthropicProviderOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model;
    this.version = options.version ?? '2023-06-01';
    this.#endpoint = options.endpoint ?? 'https://api.anthropic.com/v1/messages';
  }

  async *stream(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const response = await fetch(this.#endpoint, {
      method: 'POST',
      signal: combined,
      headers: {
        'content-type': 'application/json',
        'anthropic-version': this.version,
        'x-api-key': this.#apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens,
        stream: true,
        system: request.system,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ input: request.input, context: request.context }),
          },
        ],
      }),
    });
    if (!response.ok || response.body === null) {
      throw new Error(`Model provider request failed with status ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value as Uint8Array, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        if (dataLine === undefined || dataLine === 'data: [DONE]') continue;
        const event = JSON.parse(dataLine.slice(6)) as AnthropicEvent;
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        if (event.type === 'message_start') {
          yield { type: 'usage', usage: { inputTokens, outputTokens } };
        }
        if (event.delta?.type === 'text_delta' && event.delta.text !== undefined) {
          yield { type: 'text_delta', text: event.delta.text };
        }
        if (event.type === 'message_delta') {
          yield { type: 'usage', usage: { inputTokens, outputTokens } };
          yield { type: 'complete', stopReason: event.delta?.stop_reason ?? 'end_turn' };
        }
      }
    }
  }
}
