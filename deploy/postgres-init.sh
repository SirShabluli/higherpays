#!/bin/bash
# Runs once, on first Postgres container start, from /docker-entrypoint-initdb.d.
#
# Creates the restricted app role (`hp_app`) and sets default privileges so any
# tables the migrations create later are readable+writable by that role. This
# is what makes Row-Level Security actually enforce tenant isolation: the app
# never connects as a superuser or BYPASSRLS role.
#
# The password is read from HP_APP_PASSWORD in the container's environment.
set -eu

: "${HP_APP_PASSWORD:?HP_APP_PASSWORD env var must be set on the postgres container}"

# psql is available inside the postgres image; connect via the maintenance
# database and let the entrypoint's superuser session own the DDL.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app') THEN
      EXECUTE format('CREATE ROLE hp_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', '$HP_APP_PASSWORD');
    END IF;
  END
  \$\$;

  GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO hp_app;
  GRANT USAGE ON SCHEMA public TO hp_app;

  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hp_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO hp_app;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO hp_app;
EOSQL

echo "[postgres-init] hp_app role ready."
