# 09 Evaluations

Versioned corpora, deterministic contract cases, gate definitions, and promotion evidence.
Contract evaluations persist thresholded schema, citation, and authority gates. Configured cost,
latency, and outcome-history gates use exact-release production measurements and remain explicitly
`not_applicable` until their sample floor is met. Re-evaluation creates new append-only evidence
when the normalized production-history digest changes and retains the bounded source-run lineage;
the same snapshot is idempotent. Fixture agreement is never presented as semantic answer quality.
The API reserves a versioned `semantic_execution` request mode, but it fails closed until an
approved provider-backed evaluator is installed.
