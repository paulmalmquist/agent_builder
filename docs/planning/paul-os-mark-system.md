# Connector Marks and Agent Capability Schematics

This sanitized design record defines a quiet, local-only connector identity system.

## Standard chassis

Every connector mark renders inside the same optical box, border, and background. Marks are dimmed
at rest and become fully legible on hover or when active. A connector without an approved local SVG
uses a one-to-three-character monogram in the same chassis, so the grid never mixes visual systems.

Brand color is identification, not health or authority. Health remains explicit text. Read versus
write uses terminal shape, and current versus merely declared authority uses line style.

## Manifest contract

Plugin definitions may declare:

```yaml
spec:
  brand:
    mark: ./mark.svg
    monogram: WH
    accent: '#7A8BA3'
```

The mark must be a local relative SVG shipped with the Plugin. Remote, protocol-relative, absolute,
Windows-style, parent-traversal, and non-SVG paths are rejected. The browser never fetches a CDN and
falls back to the manifest monogram if an approved local asset cannot be delivered.

Third-party marks remain their owners’ trademarks. A deployment should use a mark only to identify
an integration, follow the owner’s usage guidance, and use the neutral monogram fallback whenever
approval is uncertain.

## Agent knowledge and ability

The expanded schematic places the Agent at one side and branches to every exact Plugin tool in its
loaded definition:

- `KNOWS` contains read-only tools.
- `CAN DO` contains write and destructive tools.
- A hollow terminal means read.
- A filled terminal means write or destructive.
- A solid branch means an active exact grant exists.
- A dashed branch means the capability is declared but not granted.

Both the shape and an accessible text label carry effect. Both the line style and text carry grant
state. Color only reinforces the distinction.

The compact form preserves the same connector chassis and effect terminal for catalog and search
rows. It must not claim authority when only a legacy provider string is available.

## Governed rules

1. Connector marks use one standard chassis.
2. Marks use local assets with monogram and accent fallbacks.
3. Effect and authority are never conveyed by color alone.
4. A missing or unsafe mark fails to the monogram without a network fallback.
5. The schematic is rendered only from exact Plugin pins and current grant evidence.
