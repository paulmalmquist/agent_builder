output "cluster_name" {
  description = "Reference cluster name."
  value       = google_container_cluster.control_plane.name
}

output "cluster_region" {
  description = "Reference cluster and data-residency region."
  value       = var.region
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name; not a credential."
  value       = google_sql_database_instance.ledger.connection_name
}

output "workload_identity_annotations" {
  description = "Apply each value to the matching Helm service account after security review."
  value = {
    for key, account in google_service_account.workload :
    key => { "iam.gke.io/gcp-service-account" = account.email }
  }
}

output "secret_containers" {
  description = "Empty Secret Manager containers. Secret versions are intentionally out of scope."
  value       = sort(keys(google_secret_manager_secret.runtime))
}
