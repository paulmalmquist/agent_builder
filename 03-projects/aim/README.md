# AIM synthetic program seed

`program.seed.json` is the public, offline Level 0 source for the AIM manufacturing capability map.
It is deliberately synthetic. Hardware labels stay literal while ownership, manufacturing method,
agent coverage, and evidence remain separate declared attributes.

To change it safely:

1. Keep `schemaVersion` at `aim.program/v2` until a new contract version exists.
2. Preserve every stable ID when changing a label.
3. Keep `ownerGroupId` canonical and maintain every bidirectional relationship required by the
   contract.
4. Derive coverage counts from `coverage.agentIds`; do not store a second count that can drift.
5. Append strictly increasing history entries rather than replacing prior observations.
6. Keep workstream dates inside `timeline`, bind each row to parts owned by its `ownerGroupId`, and
   reference only declared sources and milestones.
7. Treat checked-in workstreams as a synthetic program-plan fixture, never a live commitment.
8. Define every source, evidence item, metric, group, agent, capability, and hardware part before
   referencing it.
9. Keep public agent and connector examples explicitly synthetic and use neutral connector labels.
10. Do not commit credentials, private links, real people, protected design data, operational
    identifiers, or confidential metrics.
11. Validate through `loadAimProgram` from `@paul-os/runtime/aim` before rendering or exporting.

The checked-in interface reads the validated program into a static chain: group → hardware and make
method → modeled agents and connectors → evidence. It performs no public runtime request and does
not grant live authority.
