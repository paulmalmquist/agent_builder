# Secrets runbook

## Policy

- Git, Helm values, Terraform, logs, fixtures, manifests, and PlatformDistribution records contain
  references and digests only—never production secret values.
- Production uses separate database credentials for migrator, API, and worker.
- Prefer short-lived Workload Identity credentials. Do not download service-account JSON keys.
- The Terraform reference creates empty Secret Manager containers only. An approved operator or
  delivery controller creates versions after review.
- Fixture OIDC and PostgreSQL values exist only in `values-kind.yaml` and are unusable outside the
  disposable demo.

## Activation and rotation

1. Inventory the secret owner, consuming workload, classification, rotation interval, and revoke
   path.
2. Create a new secret version through the approved channel.
3. Validate the least-privilege workload identity can access only its own secret.
4. Restart one workload at a time and verify `/ready`, worker lease recovery, and audit evidence.
5. Revoke the prior version after the overlap window.
6. Scan logs and rendered manifests; record the rotation event without secret material.

On suspected exposure: disable the affected Plugin/provider, revoke the secret, pause new runs,
rotate, invalidate applicable authority, inspect sanitized audit evidence, and resume only after
the owner approves. Google documents [GKE Workload Identity](https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity)
and [Secret Manager access from GKE](https://cloud.google.com/kubernetes-engine/docs/tutorials/workload-identity-secrets).
