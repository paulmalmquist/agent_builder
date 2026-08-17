# Backup and restore runbook

The Terraform reference proposes regional Cloud SQL PostgreSQL with automated backups and
point-in-time recovery. It does not create or test a backup. RPO, RTO, retention, region, encryption,
and restore ownership are activation decisions.

## Scope

- Cloud SQL backups protect the operational PostgreSQL ledger.
- Git and certified release artifacts protect definitions and immutable deployment inputs.
- Artifact Registry retention protects referenced images.
- GKE backup may protect Kubernetes configuration and persistent volumes, but it does **not** back
  up Cloud SQL or deleted container images. Google states those exclusions in the
  [Backup for GKE overview](https://cloud.google.com/kubernetes-engine/docs/add-on/backup-for-gke/concepts/backup-for-gke).
- The private profile overlay needs its own encrypted backup path.

## Restore rehearsal

1. Open an incident/change record and name the restore point and authorized operator.
2. Restore to an isolated database instance, never over the active ledger first.
3. Run migrations in status-only mode; validate schema version, row counts, digests, audit chains,
   active release pointers, authority revocation, and workspace/department isolation.
4. Start an isolated API/worker pair with outbound providers disabled.
5. Execute deterministic smoke tests and compare known aggregates.
6. Record measured RPO/RTO and evidence. Destroy the rehearsal environment through approved
   change control.
7. Promote the restored database only after database, security, and service owners approve.

Cloud SQL documents [backup and recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/backups)
and [point-in-time recovery](https://cloud.google.com/sql/docs/postgres/backup-recovery/pitr).
