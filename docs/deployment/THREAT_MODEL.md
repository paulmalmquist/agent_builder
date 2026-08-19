# Proposal threat model

This is a design-review packet, not a certification. Owners must reassess it against the approved
tenant, gateway, networks, data classifications, and broker implementation before activation.

## Assets and trust boundaries

Protected assets include authority grants, release digests, prompts and outcomes, source data,
audit evidence, workspace/department boundaries, model and Plugin budgets, credentials, signing
keys, device identity, and production release pointers.

Trust boundaries are: browser or CLI to control plane; ingress to API; API/worker to PostgreSQL;
worker to model gateway and Plugins; Git definitions to imported immutable releases; Kubernetes to
Google Cloud services; and, later, control plane to the workstation broker.

| Threat                                 | Current control or proposal                                                                                                                   | Residual activation gate                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Confused-deputy data access            | OIDC principal, workspace/department scoping, exact release/entrypoint authority, registry-owned Plugin identifiers                           | Verify real group claims, data-owner grants, and negative cross-workspace tests                |
| Secret disclosure                      | Secret references only; production chart consumes existing Secrets; Terraform creates no secret versions; logs exclude prompt/response bodies | Choose approved Secret Manager delivery and rotation; scan rendered manifests and runtime logs |
| Supply-chain substitution              | Exact npm lock, release/source digests, digest-only production images, immutable PlatformDistribution                                         | Sign images/Helm/MSI, verify provenance, and define admission policy                           |
| Plugin SSRF or scope escape            | Server-owned HTTPS hosts, DNS/private-address checks, structured limits, exact installation/version/digest checks, kill switch                | Red-team every live adapter and approve outbound network policy                                |
| Cross-tenant or department leak        | Principal-scoped repositories and prototype RLS                                                                                               | Complete corporate identity mapping, FORCE RLS validation, and separate runtime-role review    |
| Scheduler duplication                  | Backend fixed at one replica; durable worker leases execution                                                                                 | Extract scheduler/maintenance ownership before horizontal API scaling                          |
| Migration race or privilege escalation | Dedicated migration Job and separate database Secret seam; app init containers wait for migration status                                      | Create least-privilege migrator/API/worker roles and rehearse rollback-compatible migration    |
| Stale/replayed workstation order       | Proposed signed nonce, lease, actor+device binding; no device-only execution                                                                  | Broker protocol implementation, certificate policy, replay tests, and security approval        |
| Unattended local execution             | Workstation residency has no silent control-plane fallback; missing user holds then expires                                                   | Enforce correct actor/device and freshness windows in the broker                               |
| Cost exhaustion                        | Run and envelope token/cost ceilings; aggregate department cost metric                                                                        | Budget alerts, gateway quotas, per-department limits, incident threshold                       |
| Evidence or metric surveillance        | Append-only evidence; adoption contract permits department aggregates and hard-rejects individual rankings                                    | Privacy/legal review of retention, cohort thresholds, access, and exports                      |
| Backup loss or corrupt restore         | Cloud SQL HA/PITR proposal and explicit restore drill                                                                                         | Approve RPO/RTO, separate backup access, test restore, document evidence                       |

## Fail-closed decisions

- Production placeholders make Helm rendering fail.
- Direct model providers are rejected in `gateway_only` mode.
- Missing PostgreSQL makes `/ready` fail but does not turn liveness into a restart loop.
- Fixture OIDC and in-cluster PostgreSQL are forbidden outside kind mode.
- Workstation requirements do not fall back to the control plane.
- A restore, infrastructure apply, corporate registration, or rollout always requires separately
  granted authority.
