# Ephemeral runtime state

Paul OS writes compiled bundles, session envelopes, caches, logs, temporary workspaces, and local
execution artifacts beneath this directory. Runtime contents are ignored by Git and are not a
backup or source of truth.

Definitions come from tracked manifests. Durable operational state and evidence belong in
PostgreSQL. Private user configuration belongs in `.local/profile/` or the path identified by
`PAUL_OS_PROFILE_PATH`.

Runtime logs must contain identifiers, hashes, state transitions, timing, and usage metadata only.
They must not contain prompts, model responses, credentials, retrieved documents, or tool payloads.
