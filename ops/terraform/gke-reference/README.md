# GKE reference — validate only

This Terraform is an architecture proposal. CI runs `fmt`, `init -backend=false`, and
`validate`; it never runs `plan` or `apply`. There is deliberately no default project ID,
credential, remote-state backend, secret version, DNS name, enterprise identity, or department
data.

The reference creates a private-node regional GKE cluster, Cloud NAT, Workload Identity service
accounts, empty Secret Manager containers, and a private regional PostgreSQL 16 Cloud SQL ledger
with point-in-time recovery. It keeps the database outside the Kubernetes lifecycle. The Helm
chart remains authoritative for the application workload.

CI pins Terraform `1.15.8` and the Google provider `7.44.0`. The committed dependency lock file
pins provider checksums; updates require an explicit version and lock-file review.

Before Enterprise Activation, owners must choose and review remote state, approved regions and
CIDRs, organization policies, ingress/egress, certificate and DNS ownership, database users and
pool limits, secret delivery, alerting, backup/restore objectives, budgets, and deletion process.
Do not apply this reference from a personal project.
