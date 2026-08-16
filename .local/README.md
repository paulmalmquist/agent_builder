# Private Paul OS overlay

This directory is the default location for the local user's private profile and connector settings.
Everything here except this file is ignored by Git.

Create `.local/profile/profile.yaml` by copying `00-core/profiles/paul.example.yaml`, then replace
only the non-secret preferences that are appropriate for the local installation. Put credentials in
environment variables or an external secret manager and refer to them by an opaque `secretRef`.

Set `PAUL_OS_PROFILE_PATH` to use a profile outside this repository. That is the recommended option
when the private profile has its own encrypted backup or private version-control policy.

Never place access tokens, source-system URLs, private hostnames, personal records, or retrieved
source content in this directory without also arranging an independent encrypted backup.
