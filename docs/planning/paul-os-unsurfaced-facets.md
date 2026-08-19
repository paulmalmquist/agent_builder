# Surfacing the Existing Paul OS Control Plane

This sanitized inventory records why the console information architecture expanded. It does not
claim that every persistence model has a complete user interface.

## Safety-critical surfaces

### Authority

Operate exposes standing authority grants, exact release identity, scopes, spend against budget,
expiry, and a governed revoke confirmation. Authority no longer disappears after approval.

### Automation

Operate exposes durable schedules, next dispatch, channel, release, authority state, and a
rationale-required pause or resume control.

### Releases and rollback

Evidence exposes the current and prior production release. When a prior certified release exists,
a rationale-required dialog can invoke the governed rollback route.

### Connections

Connections separates Plugin catalog, installation, opaque secret-reference configuration, health,
kill switch, used-by evidence, and uninstall protection from the definition Registry. Unsupported
transports remain visible but unavailable; only the implemented transport can execute.

## Daily and trust surfaces

- Catalog surfaces canonical Agent definitions, the legacy library, immutable definitions, and the
  synthetic capability-map entry when enabled.
- Operate groups runs, authority, schedules, approvals, flight recorders, and recorded context
  summaries.
- Context inspection shows durable input plus source/classification/token provenance. It explicitly
  does not claim to expose the complete provider prompt.
- Incubator continues to surface observations, reviewed improvements, and memory candidates.
- Settings shows the server-resolved request principal, workspace and department scope, roles,
  permissions, and governed Protocol, Project, and Reference definitions.

## Explicit interface boundaries

Several storage seams still lack safe list contracts. Their UI must remain visibly unavailable
rather than being reconstructed from filenames or inferred identifiers:

- Project-instance selection and overlay history.
- Principal and role-binding directory browsing.
- Repository-import history.
- Deployment and release archives.
- Complete provider-context bodies.
- Accepted-memory deletion.

These are activation follow-ons. The interface already names the missing contract so transferred
enterprise data cannot silently fall into an ungoverned placeholder.

## Navigation grouping

Operate answers one question across three tenses: what was allowed, what is scheduled, and what
happened. Connections answers what external capability exists and whether it is healthy. Settings
answers which identity and repository rules are in effect. This keeps the numbered rail short while
making the control plane inspectable.

Today is not a menu. Each connected subsystem may contribute one line only when it is nonnominal;
query failure is itself visible and never converts to “all systems nominal.”
