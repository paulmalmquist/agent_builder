# Enterprise Activation checklist

Phase 2 ends at proposal readiness. Create a separately authorized Enterprise Activation project
before checking any item that touches corporate infrastructure.

## Required sponsors and owners

| Area                            | Named owner required                    | Approval/evidence                                                |
| ------------------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| Business sponsorship and budget | Executive/product sponsor               | Scope, pilot population, budget ceiling, stop authority          |
| Security and privacy            | Security architecture and privacy/legal | Threat model, data classification, retention, pen test           |
| Identity                        | Entra administrator                     | App registrations, claims, Conditional Access, group mapping     |
| Endpoint                        | Intune/application packaging owner      | Signing, detection, install/uninstall, supersedence, rollback    |
| Platform                        | Cloud platform/SRE owner                | Project, GKE, network, ingress, DNS, certificates, observability |
| Data                            | Database owner and data stewards        | Cloud SQL, RLS, backups, source access and regional placement    |
| AI gateway                      | Approved model-platform owner           | Gateway adapter, quotas, logging policy, model allowlist         |
| Operations                      | Service owner and incident commander    | On-call, SLOs, runbooks, change control, restore drills          |

## Activation gates

1. Replace every `.invalid`, `REPLACE`, synthetic ID, and fixture credential.
2. Configure reviewed remote Terraform state and state access. Never use a personal project.
3. Review Terraform plan in the target organization; do not grant CI an apply role by default.
4. Create separate migrator, API, and worker database identities and validate forced RLS.
5. Populate Secret Manager through an approved channel; no downloaded service-account key files.
6. Map distinct backend/worker/migrator Kubernetes service accounts to approved Google service
   accounts through Workload Identity.
7. Register and validate production OIDC; remove fixture mode and deterministic demo actors.
8. Configure approved gateway and restricted Plugin set; exercise fail-closed outage paths.
9. Pin signed image and chart digests from a certified PlatformDistribution.
10. Supply ingress, TLS, DNS, WAF/rate limits, egress policy, and regional controls.
11. Approve retention, aggregate adoption metrics, and a ban on individual productivity ranking.
12. Rehearse database restore, platform rollback, secret rotation, and compromised-release response.
13. Complete load, abuse, accessibility, workstation protocol, and security tests.
14. Define pilot cohort, success metrics, support, rollback threshold, and expiry date.

## Explicit stop conditions

Stop activation if any named owner, approved gateway, signing certificate, tenant registration,
network path, external PostgreSQL, secret-delivery path, restore evidence, or rollout budget is
missing. A successful local kind demo is not evidence that those dependencies exist.
