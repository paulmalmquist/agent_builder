-- Proposal-ready prototype only. Run as a PostgreSQL cluster administrator after migrations.
-- These are NOLOGIN group roles: deployment creates/login-binds credentials out of band.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paul_os_migrator') THEN
    CREATE ROLE paul_os_migrator NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paul_os_api') THEN
    CREATE ROLE paul_os_api NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paul_os_worker') THEN
    CREATE ROLE paul_os_worker NOLOGIN NOBYPASSRLS;
  END IF;
END
$roles$;

DO $database_grants$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO paul_os_migrator, paul_os_api, paul_os_worker',
    current_database()
  );
END
$database_grants$;
GRANT USAGE ON SCHEMA public TO paul_os_migrator, paul_os_api, paul_os_worker;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO paul_os_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO paul_os_migrator;

-- Representative least-privilege slice. Existing execution/registry tables are deliberately
-- not claimed to be split yet; see docs/adr/0010-identity-and-isolation-prototype.md.
GRANT SELECT ON "Workspace", "Department", "Principal", "ExternalIdentity", "RoleBinding", "ServicePrincipal"
  TO paul_os_api, paul_os_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ProjectInstance" TO paul_os_api;
GRANT SELECT ON "ProjectInstance" TO paul_os_worker;
