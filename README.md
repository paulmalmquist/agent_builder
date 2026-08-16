# Relativity Agent Builder

A reuse-first, governed agent specification scaffold. The approved React landing page is wired to
an Express API, PostgreSQL catalog, deterministic first-party generator CLI, shadow deployment
fixture, and evaluation results.

## Workspace

```text
apps/frontend       React, Vite, TanStack Query, MSW
apps/backend        Express, Prisma, PostgreSQL, BigQuery connector boundary
apps/generator-cli  Deterministic subprocess generator
packages/contracts  Zod wire contracts, state machines, generated OpenAPI
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

Run all checks:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Docker Compose

```bash
docker compose up --build
```

The composed frontend is available on `http://localhost:8080`. PostgreSQL data is stored in a
named volume, migrations use `prisma migrate deploy`, and seeds are idempotent.
Compose publishes its development ports on `127.0.0.1` only. The image runs seeds only when
`SEED_ON_BOOT=true`; leave that flag unset outside disposable/demo environments. Compose performs
migrations and optional demo seeding in its one-shot `migrate` service before starting the backend.

## API flow

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

The application image starts only the backend process. For a managed deployment, run
`prisma migrate deploy` once in a dedicated init/release job, keep `SEED_ON_BOOT=false`, and give
the long-running runtime identity no schema or seed privileges.

## Secrets and transfer

Commit only `.env.example`. Configure these values through the destination environment or GitHub
environment secrets:

- `DATABASE_URL`
- `OPENAI_API_KEY` (reserved for a future generator adapter; unused by this scaffold)
- GCP Workload Identity provider/service account settings for future deployment

Do not commit service-account JSON, ADC files, database passwords, or vendor tokens. Confluence,
Jira, email, Slack, and Interstellar are contract fixtures only until they are wired on the work
computer.
