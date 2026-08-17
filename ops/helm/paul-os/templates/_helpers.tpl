{{- define "paul-os.name" -}}
paul-os
{{- end }}

{{- define "paul-os.fullname" -}}
{{- default (include "paul-os.name" .) .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "paul-os.labels" -}}
app.kubernetes.io/name: {{ include "paul-os.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: paul-os
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
{{- end }}

{{- define "paul-os.selectorLabels" -}}
app.kubernetes.io/name: {{ include "paul-os.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "paul-os.backendServiceAccountName" -}}
{{- if .Values.serviceAccounts.backend.create -}}
{{- default (printf "%s-backend" (include "paul-os.fullname" .)) .Values.serviceAccounts.backend.name -}}
{{- else -}}
{{- required "serviceAccounts.backend.name is required when create=false" .Values.serviceAccounts.backend.name -}}
{{- end -}}
{{- end }}

{{- define "paul-os.workerServiceAccountName" -}}
{{- if .Values.serviceAccounts.worker.create -}}
{{- default (printf "%s-worker" (include "paul-os.fullname" .)) .Values.serviceAccounts.worker.name -}}
{{- else -}}
{{- required "serviceAccounts.worker.name is required when create=false" .Values.serviceAccounts.worker.name -}}
{{- end -}}
{{- end }}

{{- define "paul-os.migratorServiceAccountName" -}}
{{- if .Values.serviceAccounts.migrator.create -}}
{{- default (printf "%s-migrator" (include "paul-os.fullname" .)) .Values.serviceAccounts.migrator.name -}}
{{- else -}}
{{- required "serviceAccounts.migrator.name is required when create=false" .Values.serviceAccounts.migrator.name -}}
{{- end -}}
{{- end }}

{{- define "paul-os.validate" -}}
{{- $mode := .Values.deploymentMode -}}
{{- if ne (int .Values.backend.replicaCount) 1 -}}
{{- fail "backend.replicaCount must remain 1 until scheduler and maintenance ownership are extracted" -}}
{{- end -}}
{{- if and (ne $mode "kind") (or .Values.kindDemo.enabled .Values.postgres.enabled) -}}
{{- fail "fixture OIDC and in-cluster PostgreSQL are permitted only in kind mode" -}}
{{- end -}}
{{- if and (eq $mode "kind") (or (not .Values.kindDemo.enabled) (not .Values.postgres.enabled)) -}}
{{- fail "kind mode requires the explicit fixture demo and in-cluster PostgreSQL" -}}
{{- end -}}
{{- if and (eq $mode "production") (ne .Values.auth.mode "oidc") -}}
{{- fail "production mode requires OIDC" -}}
{{- end -}}
{{- if and (ne $mode "kind") (ne .Values.auth.mode "oidc") -}}
{{- fail "fixture_oidc is restricted to kind mode" -}}
{{- end -}}
{{- range $name, $image := .Values.images -}}
{{- if and (ne $name "pullPolicy") (ne $mode "kind") (not (regexMatch "^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$" (toString $image))) -}}
{{- fail (printf "images.%s must be an immutable sha256 digest reference" $name) -}}
{{- end -}}
{{- if and (eq $mode "production") (contains ".invalid" (toString $image)) -}}
{{- fail (printf "images.%s still contains a proposal placeholder" $name) -}}
{{- end -}}
{{- end -}}
{{- if and (eq $mode "production") (or (contains "REPLACE" .Values.global.repositorySourceCommit) (not (regexMatch "^[a-f0-9]{7,64}$" .Values.global.repositorySourceCommit))) -}}
{{- fail "production repositorySourceCommit must be a verified hexadecimal commit" -}}
{{- end -}}
{{- if and (eq $mode "production") (or (contains ".invalid" .Values.auth.issuer) (contains ".invalid" .Values.auth.jwksUri)) -}}
{{- fail "production OIDC coordinates still contain proposal placeholders" -}}
{{- end -}}
{{- if and (eq $mode "production") (ne .Values.auth.verifier "jwks") -}}
{{- fail "production OIDC requires the JWKS verifier" -}}
{{- end -}}
{{- if and (eq $mode "production") (or (contains "REPLACE" .Values.global.modelName) (contains "REPLACE" .Values.global.pricingVersion)) -}}
{{- fail "production model and pricing configuration still contain proposal placeholders" -}}
{{- end -}}
{{- range $component, $secret := .Values.externalSecrets -}}
{{- if not $secret.name -}}
{{- fail (printf "externalSecrets.%s.name is required" $component) -}}
{{- end -}}
{{- if and (eq $mode "production") (contains "REPLACE" $secret.name) -}}
{{- fail (printf "externalSecrets.%s.name still contains a proposal placeholder" $component) -}}
{{- end -}}
{{- end -}}
{{- end }}
