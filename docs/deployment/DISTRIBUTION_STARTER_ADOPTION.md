# Distribution, starter pack, and adoption contracts

Three strict, synthetic contracts establish the proposal boundary without adding unreviewed
operational tables or APIs:

- `PlatformDistribution` binds pilot/stable channel, source/release/chart digests, and immutable
  backend/frontend/worker/migrator image references. The seed is explicitly `proposalOnly`.
- `StarterPackManifest` supplies referred release digests, Plugin pack pins, a read-only
  self-approval ceiling, and a Daily Brief subscription with a freshness window.
- `AdoptionAggregate` is department-scoped and hard-codes `containsIndividualRankings: false`.

The aggregate carries weekly active users, referred-choice acceptance, median time to first
approved run, zero-escalation rate, and department cost. Unknown fields are rejected, so an actor
ID or per-person ranking cannot be smuggled into this wire artifact.

Operational ingestion, publication routes, cohort suppression, retention, and organization-wide
rollup storage are deferred to Enterprise Activation. Before implementing them, approve a privacy
threshold, access policy, export policy, deletion/retention rule, and audit owner. The current files
are safe leadership-demo fixtures only.
