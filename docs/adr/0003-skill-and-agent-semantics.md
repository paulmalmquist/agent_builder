# ADR 0003: Skill and agent semantics

- Status: Accepted
- Date: 2026-08-16

## Context

Calling every prompt or scheduled task an agent obscures authority and lifecycle boundaries. The
baseline has concrete agent versions but no first-class reusable skill resource.

## Decision

A skill is a bounded reusable capability with typed inputs and outputs, declared dependencies,
tools, permissions, context requirements, success criteria, and evaluation coverage. It has no
persistent objective, schedule, memory policy, or autonomous loop.

An agent is a versioned operational role that composes skills and adds identity, an objective,
protocols, context and memory policy, triggers, tool policy, and an execution loop. An automation is
a separate trigger/schedule resource that requests an agent release under an authority envelope.

## Consequences

- Skills can be evaluated and reused independently.
- Agent authority is visible rather than hidden in a prompt.
- Scheduled execution does not turn a skill into an agent.
- The existing deterministic generator becomes one way to create an agent manifest, not the skill
  registry.
