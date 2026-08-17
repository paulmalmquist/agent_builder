# Proposal operating-cost model

This worksheet is not a quote. Region, commitments, utilization, logging, model pricing, and
organization discounts materially change cost. Refresh it in the
[Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator) before approval.

## Monthly formula

| Component           | Planning driver                             | Formula                                         |
| ------------------- | ------------------------------------------- | ----------------------------------------------- |
| GKE management      | Cluster-hours                               | `hours × current cluster management rate`       |
| GKE nodes           | Regional node count, machine type, disk     | `node-hours × current Compute Engine rate`      |
| Cloud SQL           | HA vCPU, memory, storage, backups, network  | Calculator output for selected region/tier      |
| Cloud NAT           | Assigned nodes, processed GiB, external IPs | Gateway-hours + GiB processing + IP-hours       |
| Registry/provenance | Stored GiB, downloads, retention            | Storage + network + scanning/provenance         |
| Logs/metrics/traces | Ingested/retained GiB and samples           | Observability SKU usage after exclusions        |
| Secret Manager      | Active versions and access operations       | Stored versions + access operations             |
| Model gateway       | Input/output tokens, tools, embeddings      | Provider price version × measured usage         |
| Backup/restore      | Cloud SQL backup and optional GKE backup    | Stored GiB + management + cross-region transfer |
| Workstation         | Signing, packaging, endpoint operations     | Enterprise contract and support estimate        |

At the published list rate, GKE cluster management alone is `$0.10 × cluster-hours` (about $72 for
a 720-hour month before applicable credits). Google documents this on the
[GKE pricing page](https://cloud.google.com/kubernetes-engine/pricing). Cloud NAT currently adds a
gateway charge, `$0.045/GiB` processing, IP-hours, and outbound transfer; verify the current
[Cloud NAT pricing](https://cloud.google.com/nat/pricing). Cloud SQL HA CPU/memory pricing varies
by region and charges failover resources; use the [Cloud SQL pricing page](https://cloud.google.com/sql/pricing)
and calculator rather than copying a stale unit rate here.

## Required scenarios

Produce low/base/high estimates for pilot and stable channels. Each must state users, departments,
runs/day, peak concurrency, node count, database size/growth, retention, outbound GiB, model tokens,
Plugin calls, backup region, and support assumption. Add 20% uncertainty until one month of
synthetic/pilot telemetry exists.

Budget controls must exist at cloud project, model gateway, department authority envelope, and run
levels. Report department aggregates only. Do not derive individual productivity rankings.
