# ADR 0007: Provider-neutral model execution

- Status: Accepted
- Date: 2026-08-16

## Context

The verified baseline contains deterministic generation and certification but no model call. Paul OS
needs an initial local model provider without coupling resource definitions or execution evidence to
one vendor.

## Decision

Define a provider-neutral streaming interface with structured input, validated output, usage,
latency, cancellation, and typed failures. Implement:

1. a deterministic provider for CI;
2. an explicitly enabled direct Claude adapter for local use;
3. a future compliant-gateway adapter seam.

Credentials come only from the environment or an external secret manager. Prompts, responses,
credentials, and source payloads are never logged. Runs record provider, model, adapter version,
pricing version, token usage, latency, and estimated cost.

`providerPolicy: gateway_only` rejects direct providers and fails closed if no gateway is configured.
It makes no regulatory compliance claim.

## Consequences

- CI is deterministic and credential-free.
- Provider changes do not alter skill or agent contracts.
- Direct execution remains an explicit local choice.
- Semantic evidence must record the exact provider configuration used.
