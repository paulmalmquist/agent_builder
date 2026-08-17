# AIM synthetic program seed

`program.seed.json` is the public, offline Level 0 source for the AIM capability visualization. It is deliberately synthetic and uses conceptual proxy anchors only.

To change it safely:

1. Keep `schemaVersion` at `aim.program/v1` until a new contract version exists.
2. Never change an existing ID to rename a label.
3. Append strictly increasing history entries rather than replacing prior observations.
4. Define every source, evidence item, metric, group, capability, part, and anchor before referencing it.
5. Do not commit credentials, private links, real people, protected geometry, operational identifiers, or confidential metrics.
6. Validate through `loadAimProgram` from `@paul-os/runtime/aim` before rendering or exporting.

The seed's geometry is explicitly labeled `CONCEPTUAL GEOMETRY — NOT VEHICLE CAD`.
