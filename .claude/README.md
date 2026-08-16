# Claude Code adapter

This directory provides safe, repository-local guidance for Claude Code. It is an adapter to Paul
OS, not a second skill registry.

- `commands/` contains human-invoked prompts that delegate to canonical manifests.
- `hooks/` documents the hook safety boundary. No effectful unattended hook is enabled.
- `settings.json` denies common secret reads and destructive Git operations.

Generated adapters, if enabled later, must be rebuilt from `02-skills` and written below an ignored
runtime path. Never copy private profile values into this directory.
