# Paul OS

A Git-authored, PostgreSQL-governed agent platform built around bounded authority, immutable
releases, durable execution, and evidence. The current vertical slice compiles a synthetic daily
brief skill, imports an immutable release, grants a scoped authority envelope, executes through a
deterministic or explicitly enabled model provider, and records an outcome with usage and cost
metrics.

## Workspace

```text
apps/frontend       React, Vite, TanStack Query, MSW
apps/backend        Express, Prisma, PostgreSQL, BigQuery connector boundary
apps/worker         Durable PostgreSQL lease/heartbeat execution worker
apps/generator-cli  Deterministic subprocess generator
packages/contracts  Zod wire contracts, state machines, generated OpenAPI
packages/runtime    Manifest compiler, profile validation, model-provider boundary

00-core ... 12-agents  Git-authored manifests, guidance, fixtures, and contract tests
```

Node 22 or newer and npm 10.9.2 are required. Dependencies are exact-pinned and installed from the
root lockfile.

## Local setup

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/agents`, `/health`, and
`/openapi.json` to the backend on port 3000. The backend binds to `127.0.0.1` by default; set
`HOST=0.0.0.0` only inside a container or behind an authenticated network boundary.

Local `npm run dev` keeps execution in the backend process for a low-friction development loop.
To exercise the durable worker locally, set `EXECUTION_DISPATCH_MODE=external`, build the worker,
and run `npm run start:worker` in a second terminal.

Run all checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run check:sanitized
```

## Docker Compose

```bash
docker compose up --build
```

The composed frontend is available on `http://localhost:8080`. PostgreSQL data is stored in a
named volume, migrations use `prisma migrate deploy`, and seeds are idempotent. Compose runs the
dedicated worker and configures the backend with `EXECUTION_DISPATCH_MODE=external`, so only the
worker claims model-execution runs.
Compose publishes its development ports on `127.0.0.1` only. The image runs seeds only when
`SEED_ON_BOOT=true`; leave that flag unset outside disposable/demo environments. Compose performs
migrations and optional demo seeding in its one-shot `migrate` service before starting the backend.

## Paul OS vertical slice

The canonical definition is `02-skills/daily-brief/manifest.yaml`. The runtime compiler parses
restricted YAML, validates it with Zod, resolves exact dependencies, rejects cycles, serializes a
canonical representation, and produces a deterministic digest. The `/v1` control plane imports the
definition and creates immutable release bundles, authority grants, execution runs, approvals,
outcomes, and metric samples.

An authority grant binds an exact release digest, project, input constraints, tool scopes, validity
window, run count, and cost ceilings. Revoked, expired, exhausted, or scope-mismatched grants fail
closed. The deterministic provider is the default and is used in CI. Direct model access is opt-in,
credential-gated, and rejected when `PROVIDER_POLICY=gateway_only`.

The console preserves the matte-black and purple instrument design across five surfaces: Build,
Registry, Runs & Approvals, Evidence, and Incubator. Existing builder, library, and certification
routes remain available during the compatibility period described in
`docs/adr/0009-legacy-api-sunset.md`.

## Legacy Agent Builder flow

1. Search with `GET /agents?query=...` and score candidates with `POST /agents/similarity`.
2. Create a draft with `POST /agents/specs`.
3. Replace each section with `PUT /agents/specs/:id/{outcomes|knowledge|guardrails|outputs}`.
4. Start generation with `POST /agents/specs/:id/generate` and poll the returned status URL.
5. Shadow deploy a ready agent and read its evaluation report.
6. Start certification with `POST /agents/:id/certification-runs`, inspect its evidence, and
   explicitly promote a passing, fresh challenger with a required human rationale.

`GET /agents` returns one representative per family. Pass `familyId=<uuid>` to list its concrete
versions. The `/library` and `/certification/:agentId` frontend routes use these same governed
resources. Single-shot interpretation is an input method only: it creates reviewable section
drafts, while the canonical four-section validation and generation gate remain unchanged.

The scaffold's certification executor is intentionally deterministic. `manifest_fixture@1.0.0`
measures manifest/corpus coverage agreement, not live semantic answer quality; every run records
its executor kind, version, and evaluation mode so this evidence cannot be misrepresented later.

`GET /agents/search` is intentionally unsupported. The complete generated contract is served at
`GET /openapi.json`.

## BigQuery

BigQuery is disabled by default. When enabled, `GOOGLE_CLOUD_PROJECT` and a long
`AUTH_BEARER_TOKEN` are mandatory. The backend uses Application Default Credentials,
the `bigquery.readonly` OAuth scope, server-owned source descriptors, dry runs, and
`maximumBytesBilled`. It never accepts SQL or table identifiers from clients and never falls back
to fixtures after a live dependency failure. BigQuery descriptors are restricted to the configured
project and carry an explicit server-owned column projection; `SELECT *` is not used.

For local, non-container development:

```bash
gcloud auth application-default login
gcloud config set project YOUR_GOVERNED_PROJECT
```

Then explicitly set `GOOGLE_CLOUD_PROJECT`, `AUTH_BEARER_TOKEN`, and `BIGQUERY_ENABLED=true`.
Send the token as `Authorization: Bearer ...`. `AUTH_ACTOR_ID` is threaded through request context
and written to `Agent.createdBy`/`updatedBy`, `AgentSpec.createdBy`/`updatedBy`, and append-only
`AuditEvent` records. The configured ADC identity must also have read-only IAM access. Do not use
downloaded service-account keys on developer laptops.
Tests and pull-request CI never use live GCP credentials.

Each future provider has an independent enable flag. Enabling a provider without a configured live
connector fails closed instead of falling back to fixtures. The connector boundary separates source
validation, tabular preview, and document-search capabilities, and includes a shared timeout,
jittered-retry, circuit-breaker, and short-TTL cache policy for outbound HTTP connectors.

## Runtime operations

`DATABASE_URL` carries Prisma's `connection_limit` and `pool_timeout`; tune both for the deployed
database and instance count. On `SIGINT`/`SIGTERM`, the backend stops accepting traffic and waits up
to `SHUTDOWN_TIMEOUT_MS`. A forced exit can interrupt a generator; boot recovery marks its job
failed and restores the spec to a recoverable state.

The in-process maintenance scheduler re-certifies due champions, removes expired unattached
interpretations, and compacts old non-promotion certification results. Configure its UTC hour with
`MAINTENANCE_HOUR_UTC`, or disable `MAINTENANCE_ENABLED` when an external scheduler invokes the same
idempotent maintenance service. Promotion-evidence runs and published corpus membership are never
pruned.

The independent automation clock calls the database-locked, idempotent schedule service once on
boot and then every `AUTOMATION_SCHEDULER_INTERVAL_MS` (30 seconds by default), claiming at most
`AUTOMATION_SCHEDULER_BATCH_SIZE` schedules per tick. Set `AUTOMATION_SCHEDULER_ENABLED=false` when
an external scheduler owns this clock. Process-local ticks never overlap; PostgreSQL advisory locks,
unique occurrence keys, and dispatch leases prevent duplicates across backend instances. Shutdown
stops the clock and waits for an in-flight scheduling transaction before disconnecting.

`PAUL_OS_PROFILE_PATH` resolves the gitignored private profile (default
`.local/profile/profile.yaml`). The runtime loader validates it and exposes only `context`, a
content digest, classification, timestamp, and token contribution—never secret references or the
filesystem path. A daily-brief request assembles the fixed-precedence core and optional private
profile layers, then persists only an immutable digest and sanitized source/classification/token
summary. Idempotency and authority grants bind to that exact digest. Immediately before calling a
model, the backend or external worker reloads the local profile, reproduces the envelope, and fails
closed if it is missing, invalid, or changed. The full private context exists only in memory and is
passed ephemerally to the provider; it is never written to the run, grant, audit log, or API
response. When using a private profile with separate backend and worker processes, both must resolve
the same file content. With no profile file (the default Compose setup), both use the stable public
core context and behavior remains credential-free.

The backend image starts only the HTTP process, and the worker image starts only the durable
execution daemon. For a managed deployment, run
`prisma migrate deploy` once in a dedicated init/release job, keep `SEED_ON_BOOT=false`, and give
the long-running runtime identity no schema or seed privileges.

The worker claims queued work with PostgreSQL leases and heartbeats, records attempts and
idempotency keys, honors cancellation and bounded retries, and recovers expired leases after a
restart. Its graceful-shutdown window is controlled by `WORKER_SHUTDOWN_TIMEOUT_MS`.

## Secrets and transfer

Commit only `.env.example`. Configure these values through the destination environment or GitHub
environment secrets:

- `DATABASE_URL`
- `ANTHROPIC_API_KEY` only when the direct local provider is intentionally enabled
- GCP Workload Identity provider/service account settings for future deployment

Do not commit service-account JSON, ADC files, database passwords, vendor tokens, prompts, model
responses, or private profile data. Confluence, Jira, email, Slack, and telemetry sources are
contract fixtures only until an explicitly configured live connector is available. Historical
migration literals are handled by the narrow allowlist documented in `docs/SANITIZATION.md`; active
content is checked by `npm run check:sanitized`.
