variable "project_id" {
  description = "Enterprise Activation project ID. No default prevents accidental personal-project use."
  type        = string
}

variable "region" {
  description = "Single data-residency region for the reference control plane."
  type        = string
  default     = "us-central1"
}

variable "cluster_name" {
  description = "Regional GKE cluster name."
  type        = string
  default     = "paul-os-control-plane"
}

variable "namespace" {
  description = "Namespace used by the Helm release and Workload Identity bindings."
  type        = string
  default     = "paul-os"
}

variable "master_authorized_networks" {
  description = "Security-approved CIDRs allowed to reach the public control-plane endpoint."
  type = map(object({
    cidr_block   = string
    display_name = string
  }))
  validation {
    condition     = length(var.master_authorized_networks) > 0
    error_message = "At least one reviewed control-plane CIDR is required."
  }
}

variable "node_machine_type" {
  description = "Reference Standard node shape; validate with a load test before activation."
  type        = string
  default     = "e2-standard-4"
}

variable "node_count" {
  description = "Reference nodes per regional location."
  type        = number
  default     = 1
  validation {
    condition     = var.node_count >= 1 && var.node_count <= 10
    error_message = "node_count must be between 1 and 10."
  }
}

variable "database_tier" {
  description = "Reference Cloud SQL tier; size from measured workload before activation."
  type        = string
  default     = "db-custom-2-7680"
}

variable "labels" {
  description = "Non-sensitive cost and ownership labels."
  type        = map(string)
  default = {
    application = "paul-os"
    posture     = "proposal"
  }
}
