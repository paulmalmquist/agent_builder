# ADR 0010: Identity and isolation prototype boundary

## Status

Accepted for the proposal-ready workstation checkpoint.

## Decision

Paul OS uses a workspace-owned `Principal` as the authorization subject. External OIDC
issuer/subject pairs map to that subject through `ExternalIdentity`; machine actors add a thin
`ServicePrincipal`. `RoleBinding` grants one of four ordered roles (`consumer`, `builder`, `owner`,
`admin`). Administrators are workspace-scoped; consumer, builder, and owner bindings are
department-scoped. Project-scoped roles are deliberately rejected until their semantics have an
end-to-end authorization test. `ProjectInstance` is unique by workspace and slug.

Tokens establish only a verified issuer/subject pair. The server chooses the workspace from trusted
deployment configuration, while the database owns principal activity, home department, and active
role bindings. Token group, workspace, department, and role claims never authorize a request. Group
claims may be observed by a future provisioning/synchronization job, but that job must write governed
role bindings before they take effect.

Nullable scope columns do not provide reliable uniqueness by themselves. Each role binding therefore
stores a checked canonical `scopeKey` (`workspace` or `department:<uuid>`) and uses it in its
compound unique key. The database CHECK constraint binds role and scope rather than relying on the
application to combine them correctly.

Human names, governed ordinals, and externally supplied idempotency keys are local to their owning
scope. Workspace compound keys now cover Agent families, Knowledge Source descriptor IDs,
certification configuration versions, evaluation case keys, corpus version numbers, Resource family
kind/slug pairs, production channel keys/project aliases, execution requests, observations, briefing
delivery attempts, catalog-index events, and Builder decisions. Child effects without a direct
workspace column use their globally unique owning aggregate (`runId`, `scheduleId`, or `familyId`) as
the compound-key prefix. The production channel and Knowledge Source primary keys are compound, so
their foreign keys cannot silently bind a record from another workspace.

Content-addressed identity remains intentionally global: `ResourceVersion.digest`,
`ReleaseBundle.digest`, and `EvalCorpusVersion.contentHash`. Workspace slugs remain globally unique
directory keys; UUID one-to-one constraints remain global referential invariants; and
`PlatformEvent.sequence` remains a global monotonic ledger cursor rather than a user-supplied key.

`ProjectInstance` is the representative database-enforced slice. It uses `ENABLE` and `FORCE ROW
LEVEL SECURITY`; a scoped transaction sets workspace, department, effective roles, permissions, and
workspace-administrator state with transaction-local PostgreSQL settings. Department roles see only
their department. A workspace administrator can operate across its departments. API, worker, and
migrator are separate `NOLOGIN`, `NOBYPASSRLS` group roles. Tests verify that the representative API
transaction runs as a non-owner, non-superuser role and that no settings bleed into a later
transaction. Login credentials and role membership remain deployment concerns.

The local, static-bearer, and signed fixture-OIDC adapters are development/test mechanisms. Production
rejects all three and requires OIDC. The production OIDC configuration contract validates HTTPS
issuer, audience, JSON Web Key Set endpoints, and an RS256 algorithm allowlist. A
standards-compatible JOSE remote-JWKS verifier is included behind an explicit `jwks` setting; the
default remains fail closed. Both fixture and production OIDC paths require persisted directory
mapping.

## Deliberate limits

- RLS does not yet cover legacy agent, registry, execution, plugin, evidence, or attention tables.
- Legacy `Agent` and `CertificationRun` rows still inherit workspace identity through their family
  instead of storing `workspaceId` directly. Agent slug and nightly schedule uniqueness are therefore
  family-scoped. Adding direct workspace foreign keys belongs with the legacy `/agents` table sunset;
  doing it independently would duplicate scope authority and require a broader relation backfill.
- Existing API and worker processes still use the shared `DATABASE_URL`; separate deployment URLs are
  declared but are not the default until every repository is scoped and tested.
- No browser sign-in, enterprise directory, live tenant, or group synchronization is included.
- The worker group role has read access only to this identity/project prototype. Existing worker paths
  require a later privilege inventory before it can run under that role.

These limits prevent this checkpoint from being represented as production multi-tenant isolation.
