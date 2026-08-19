# Rollback runbook

Rollback is digest-based and human-approved. It is not a blind database downgrade.

## Application release

1. Stop new promotions and scheduled starts if safety is uncertain.
2. Select a previously certified PlatformDistribution and verify its chart/image/release digests.
3. Confirm the current database schema is backward-compatible with the prior application.
4. Roll back the Helm release or production release pointer under change control.
5. Verify `/live`, `/ready`, migration status, worker leases, Plugin health, and a deterministic run.
6. Record rationale, actor, evidence, customer impact, and follow-up candidate.

If schema compatibility is unknown, forward-fix the application. Restore PostgreSQL only through
the backup runbook and incident approval; Prisma migrations are forward deployment artifacts, not
an automatic down-migration mechanism.

## Workstation distribution

Retain a signed prior MSI and exact detection metadata. Use an authorized Intune supersedence or
uninstall/retarget sequence, then revoke trust in the compromised broker release at the control
plane. Microsoft notes that supersedence targeting and uninstall behavior are separate decisions;
review the current [Intune supersedence guidance](https://learn.microsoft.com/intune/app-management/deployment/configure-win32-supersedence).

## Stop criteria

Stop rollback on digest mismatch, missing certification, incompatible schema, unknown secret
version, failed readiness, dual scheduler ownership, or loss of audit evidence.
