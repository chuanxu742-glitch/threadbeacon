{{- define "threadbeacon-execution.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "threadbeacon-execution.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "threadbeacon-execution.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "threadbeacon-execution.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | quote }}
app.kubernetes.io/name: {{ include "threadbeacon-execution.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}

{{- define "threadbeacon-execution.secretName" -}}
{{- if .Values.gateway.existingSecret }}{{ .Values.gateway.existingSecret }}{{ else }}{{ include "threadbeacon-execution.fullname" . }}{{ end }}
{{- end }}

{{- define "threadbeacon-execution.controlSecretName" -}}
{{- if .Values.controlPlane.existingSecret }}{{ .Values.controlPlane.existingSecret }}{{ else }}{{ include "threadbeacon-execution.fullname" . }}{{ end }}
{{- end }}
