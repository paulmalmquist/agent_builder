# Entra and Intune proposal runbook

No Entra application, group, assignment, certificate, package, or tenant change is created by this
repository. These are review steps for an authorized endpoint/identity project.

## Control-plane identity

1. Register a workforce, single-tenant web API.
2. Give it an application-ID URI and least-privilege delegated scopes.
3. Configure the exact issuer, audience, and JWKS URI in external environment Secrets.
4. Define the group claim and validate the reviewed mapping against
   `entraGroupMappingConfigSchema` (`entra-group-mapping/v1`). The configuration is
   `provisioning_only`: it creates or updates reviewed database RoleBindings, while token groups
   remain observational and never grant request authority directly.
5. Fail authentication when issuer, audience, signature, identity, workspace, or department mapping
   is absent. Do not infer an elevated role from an unmapped group.
6. Exercise key rotation, group removal, disabled users, stale tokens, and cross-workspace denial.

Microsoft documents the [application sign-in flow](https://learn.microsoft.com/entra/identity-platform/app-sign-in-flow)
and [desktop application registration](https://learn.microsoft.com/entra/identity-platform/quickstart-desktop-app-sign-in).

## Workstation broker identity proposal

The thin Windows broker remains a separate implementation. The production protocol requires both:

- a non-exportable certificate from an enrolled device; and
- a current user token acquired through MSAL.NET and Windows Web Account Manager.

Neither identity alone may execute a work order. Orders are signed, nonce-protected, actor/device
bound, leased, and freshness-limited. A missing user holds the run as `waiting_for_user`; it does
not fail and does not silently execute centrally. Expired work is cancelled without late effects.

Microsoft documents [MSAL.NET with WAM](https://learn.microsoft.com/entra/msal/dotnet/acquiring-tokens/desktop-mobile/wam)
and notes its Windows broker and Conditional Access benefits. A test/local broker artifact is not a
production-signed package.

## Intune packaging proposal

1. Produce a signed MSI only from a certified PlatformDistribution.
2. Define quiet install/uninstall commands and an exact version detection rule.
3. Test system-context service install, per-user companion behavior, repair, reboot, and removal.
4. Target a pilot group explicitly; supersedence does not itself target users or devices.
5. Configure supersedence, monitor installation status, and retain a reviewed rollback package.
6. Revoke the control-plane distribution pointer and broker work-order trust if a version is
   compromised; endpoint uninstall alone is not sufficient.

Use Microsoft's current [Win32 app deployment](https://learn.microsoft.com/intune/app-management/deployment/add-win32)
and [supersedence](https://learn.microsoft.com/intune/app-management/deployment/configure-win32-supersedence)
guidance during the authorized project.
