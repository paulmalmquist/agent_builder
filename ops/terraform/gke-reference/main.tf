locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "container.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  workload_identities = {
    backend = {
      account_id = "paul-os-backend"
      ksa        = "paul-os-backend"
    }
    worker = {
      account_id = "paul-os-worker"
      ksa        = "paul-os-worker"
    }
    migrator = {
      account_id = "paul-os-migrator"
      ksa        = "paul-os-migrator"
    }
  }
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "control_plane" {
  name                    = "paul-os-control-plane"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "control_plane" {
  name                     = "paul-os-control-plane-${var.region}"
  region                   = var.region
  network                  = google_compute_network.control_plane.id
  ip_cidr_range            = "10.42.0.0/20"
  private_ip_google_access = true
  secondary_ip_range {
    range_name    = "paul-os-pods"
    ip_cidr_range = "10.48.0.0/14"
  }
  secondary_ip_range {
    range_name    = "paul-os-services"
    ip_cidr_range = "10.52.0.0/20"
  }
}

resource "google_compute_router" "control_plane" {
  name    = "paul-os-control-plane"
  region  = var.region
  network = google_compute_network.control_plane.id
}

resource "google_compute_router_nat" "control_plane" {
  name                               = "paul-os-control-plane"
  router                             = google_compute_router.control_plane.name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  subnetwork {
    name                    = google_compute_subnetwork.control_plane.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

resource "google_compute_global_address" "private_services" {
  name          = "paul-os-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.control_plane.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.control_plane.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on              = [google_project_service.required]
}

resource "google_service_account" "nodes" {
  account_id   = "paul-os-gke-nodes"
  display_name = "Paul OS GKE nodes"
  depends_on   = [google_project_service.required]
}

resource "google_project_iam_member" "node_runtime" {
  for_each = toset([
    "roles/artifactregistry.reader",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/monitoring.viewer",
    "roles/stackdriver.resourceMetadata.writer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.nodes.email}"
}

resource "google_container_cluster" "control_plane" {
  name                        = var.cluster_name
  location                    = var.region
  network                     = google_compute_network.control_plane.id
  subnetwork                  = google_compute_subnetwork.control_plane.id
  remove_default_node_pool    = true
  initial_node_count          = 1
  deletion_protection         = true
  enable_shielded_nodes       = true
  enable_intranode_visibility = true
  datapath_provider           = "ADVANCED_DATAPATH"
  logging_service             = "logging.googleapis.com/kubernetes"
  monitoring_service          = "monitoring.googleapis.com/kubernetes"

  release_channel {
    channel = "REGULAR"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "paul-os-pods"
    services_secondary_range_name = "paul-os-services"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.master_authorized_networks
      content {
        cidr_block   = cidr_blocks.value.cidr_block
        display_name = cidr_blocks.value.display_name
      }
    }
  }

  secret_manager_config {
    enabled = true
  }

  addons_config {
    gke_backup_agent_config {
      enabled = true
    }
  }

  depends_on = [
    google_project_service.required,
    google_project_iam_member.node_runtime,
  ]
}

resource "google_container_node_pool" "control_plane" {
  name       = "paul-os-primary"
  location   = var.region
  cluster    = google_container_cluster.control_plane.name
  node_count = var.node_count

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type    = var.node_machine_type
    service_account = google_service_account.nodes.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]
    labels          = var.labels
    metadata = {
      disable-legacy-endpoints = "true"
    }
    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

resource "google_sql_database_instance" "ledger" {
  name                = "paul-os-ledger"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = true

  settings {
    tier              = var.database_tier
    availability_type = "REGIONAL"
    disk_autoresize   = true
    disk_size         = 50
    disk_type         = "PD_SSD"
    user_labels       = var.labels

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.control_plane.id
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = true
      record_client_address   = false
    }
  }

  depends_on = [google_service_networking_connection.private_services]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "workload" {
  for_each     = local.workload_identities
  account_id   = each.value.account_id
  display_name = "Paul OS ${each.key} workload"
  depends_on   = [google_project_service.required]
}

resource "google_project_iam_member" "workload_cloud_sql" {
  for_each = local.workload_identities
  project  = var.project_id
  role     = "roles/cloudsql.client"
  member   = "serviceAccount:${google_service_account.workload[each.key].email}"
}

resource "google_service_account_iam_member" "workload_identity" {
  for_each           = local.workload_identities
  service_account_id = google_service_account.workload[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.namespace}/${each.value.ksa}]"
}

resource "google_secret_manager_secret" "runtime" {
  for_each = toset([
    "paul-os-api-database",
    "paul-os-worker-database",
    "paul-os-migrator-database",
    "paul-os-backend-environment",
    "paul-os-worker-environment",
  ])
  secret_id = each.key
  replication {
    auto {}
  }
  labels     = var.labels
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "backend_database" {
  secret_id = google_secret_manager_secret.runtime["paul-os-api-database"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["backend"].email}"
}

resource "google_secret_manager_secret_iam_member" "backend_environment" {
  secret_id = google_secret_manager_secret.runtime["paul-os-backend-environment"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["backend"].email}"
}

resource "google_secret_manager_secret_iam_member" "worker_database" {
  secret_id = google_secret_manager_secret.runtime["paul-os-worker-database"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["worker"].email}"
}

resource "google_secret_manager_secret_iam_member" "worker_environment" {
  secret_id = google_secret_manager_secret.runtime["paul-os-worker-environment"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["worker"].email}"
}

resource "google_secret_manager_secret_iam_member" "migrator_database" {
  secret_id = google_secret_manager_secret.runtime["paul-os-migrator-database"].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.workload["migrator"].email}"
}
