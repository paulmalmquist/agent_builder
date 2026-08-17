# Local kind demonstration

This is a synthetic control-plane demonstration, not a workstation broker and not an enterprise
deployment. It uses fixture OIDC, deterministic model execution, and an in-cluster fixture
PostgreSQL instance only through `values-kind.yaml`. No corporate tenant, gateway, certificate,
secret, data, or hostname is required.

Pinned tools used by CI:

- kind `v0.32.0`
- kubectl `v1.35.0`
- Helm `v4.2.3`

Build the three repository images with their `:kind` names, create the cluster from
`kind-config.yaml`, load those images, then install the chart:

```text
kind create cluster --name paul-os-demo --config ops/kind/kind-config.yaml
kind load docker-image paul-os/backend:kind paul-os/frontend:kind paul-os/worker:kind --name paul-os-demo
helm upgrade --install paul-os ops/helm/paul-os --namespace paul-os --create-namespace --values ops/helm/paul-os/values-kind.yaml --wait --wait-for-jobs --timeout 10m
```

The console is exposed at `http://127.0.0.1:18080`. Verify `/live`, `/ready`, and
`/openapi.json`. Delete the cluster when finished; the demo contains no durable personal state.
