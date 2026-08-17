# Portable control-plane reference

Status: **proposal/demo only**. Nothing in this directory authorizes an enterprise deployment,
creates a corporate identity, buys infrastructure, or enables workstation execution.

## What is executable now

- The Helm chart renders the backend, worker, frontend, migration job, network policy, and three
  distinct Kubernetes service-account seams.
- `/live` is process liveness. `/ready` verifies PostgreSQL. Both are proxied by the frontend.
- `values-kind.yaml` is the only mode that may create fixture OIDC material or PostgreSQL.
- The kind workflow builds local images, deploys the fixture chart, and checks health.
- The GKE Terraform reference can be formatted and validated without credentials. CI has no
  `plan` or `apply` step.

## Production posture

Production values require external PostgreSQL connection Secrets, separate API/worker/migrator
database identities, OIDC, approved gateway mode, a verified source commit, and image digest
references. The production example intentionally fails chart rendering while placeholders remain.
The chart does not create production Secrets, database credentials, an ingress, TLS certificates,
DNS, or identity registrations.

The backend remains `replicaCount: 1`. It still owns in-process scheduler and maintenance seams;
replicating it would create ambiguous ownership. Extract those leases before permitting more than
one backend replica. The durable worker is a separate Deployment.

## Client/control-plane boundary

Browser and future workstation clients use `/v1` contracts only. They do not connect directly to
PostgreSQL. A future workstation broker is an outbound client and local Plugin executor, not a
second control plane. Workstation Plugin requirements remain unavailable until the dual-identity
broker protocol is separately implemented and approved.

## Deferred operational seams

The strict PlatformDistribution, StarterPack, and aggregate adoption contracts are validated from
synthetic content. Persisted ingestion, publication APIs, real starter-pack provisioning, and
organization metric rollups are deferred to Enterprise Activation so this checkpoint does not add
an unreviewed operational database model.

## Primary references

- [Kubernetes probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/)
- [Helm chart best practices](https://helm.sh/docs/chart_best_practices/)
- [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/)
- [GKE Terraform quickstart](https://cloud.google.com/kubernetes-engine/docs/quickstarts/create-cluster-using-terraform)
- [Workload Identity Federation for GKE](https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity)
- [Cloud SQL from GKE](https://cloud.google.com/sql/docs/postgres/connect-kubernetes-engine)
- [Terraform dependency locking](https://developer.hashicorp.com/terraform/language/files/dependency-lock)
