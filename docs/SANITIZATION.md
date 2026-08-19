# Repository sanitization policy

Paul OS is intended to remain safe for a public repository. Active source, tests, fixtures,
configuration, documentation, generated definitions, and image inputs must use neutral names and
synthetic data. Run `npm run check:sanitized` locally; CI runs the same deterministic check.

The only path allowlisted by the check is the released baseline migration directory
`apps/backend/prisma/migrations/20260731000000_init/`. Released migrations are immutable
operational history: rewriting one changes its checksum and can break deployment to databases that
already applied it. The Paul OS vertical-slice migration has one exact line-level exception solely
to rename the legacy provider enum value to `telemetry`; the rest of that migration remains scanned.
An allowlisted historical literal is not permission to reuse it in a current schema, seed, fixture,
source file, or document.

Private profile data belongs in gitignored `.local/profile/` or in the path named by
`PAUL_OS_PROFILE_PATH`. Runtime payloads, prompts, responses, caches, and logs belong in
gitignored `.runtime/`. Neither directory is an exception to the rule that credentials and private
source data must never be committed.
