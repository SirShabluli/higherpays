-- ============================================================================
-- HigherPays — Creator Agency Operating System
-- Migration 001: initial schema (multi-tenant)
-- Target: PostgreSQL 14+
--
-- Tenancy model:
--   organizations 1---* workspaces (a workspace = one brand / merchant MID)
--   Every tenant-scoped row carries workspace_id. The application MUST filter
--   every query by the caller's workspace_id. Optional DB-level enforcement via
--   Row-Level Security is provided separately in 002_row_level_security.sql.
--
-- Money is stored as NUMERIC (never float). Secrets/media are NEVER stored here:
--   only references (object-storage keys, secret-store key names) are kept.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- Shared helper: keep updated_at current
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------
CREATE TYPE membership_role   AS ENUM ('owner','admin','manager','analyst','chatter','creator');
CREATE TYPE entity_status     AS ENUM ('active','suspended','pending','archived');
CREATE TYPE creator_status    AS ENUM ('onboarding','active','paused','archived');
CREATE TYPE customer_segment  AS ENUM ('new','regular','high_value','vip','inactive','at_risk');
CREATE TYPE link_status       AS ENUM ('created','opened','paid','failed','refunded','expired');
CREATE TYPE txn_status        AS ENUM ('approved','declined','refunded','charged_back');
CREATE TYPE txn_type          AS ENUM ('payment','refund','chargeback','adjustment');
CREATE TYPE payout_status     AS ENUM ('pending','approved','paid','on_hold');
CREATE TYPE compliance_status AS ENUM ('unverified','pending_review','verified','rejected','expired');
CREATE TYPE content_type      AS ENUM ('photo','video','ppv','custom','vip');

-- ---------------------------------------------------------------------------
-- organizations — top-level tenant (the white-label customer / agency account)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  status      entity_status NOT NULL DEFAULT 'active',
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- workspaces — a brand / merchant MID under an organization.
-- This is the primary tenant boundary for all operational data.
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  mid                  text,                                   -- merchant ID at the PSP
  currency             char(3) NOT NULL DEFAULT 'EUR',
  brand                jsonb NOT NULL DEFAULT '{}'::jsonb,      -- {name, color, initial}
  status               entity_status NOT NULL DEFAULT 'active',
  provider_name        text,                                   -- e.g. 'qrmoney'
  provider_config_ref  text,                                   -- KEY NAME in secret store, NOT the secret
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_workspaces_org ON workspaces(organization_id);
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- users — global identity (a person may belong to several workspaces)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  password_hash  text,                        -- set by app (argon2/bcrypt); null until onboarded
  full_name      text NOT NULL,
  status         entity_status NOT NULL DEFAULT 'active',
  mfa_enabled    boolean NOT NULL DEFAULT false,
  mfa_secret_ref text,                        -- reference to secret store, NOT the TOTP secret
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- memberships — user ↔ workspace with a role. RBAC is enforced from here.
-- Chatters are users with role='chatter'; shift lives on the membership.
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id)      ON DELETE CASCADE,
  role         membership_role NOT NULL,
  status       entity_status NOT NULL DEFAULT 'active',
  shift        text,                                   -- 'day' | 'night' | null (chatters)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX idx_memberships_ws   ON memberships(workspace_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- creators
-- ---------------------------------------------------------------------------
CREATE TABLE creators (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stage_name        text NOT NULL,
  handle            text,
  legal_name        text,          -- RESTRICTED: expose to admins only; consider column-level encryption
  country           char(2),
  status            creator_status NOT NULL DEFAULT 'onboarding',
  revenue_split_pct numeric(5,2) NOT NULL DEFAULT 70.00 CHECK (revenue_split_pct BETWEEN 0 AND 100),
  brand             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_creators_ws ON creators(workspace_id);
CREATE TRIGGER trg_creators_updated BEFORE UPDATE ON creators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- creator_compliance — age / identity verification (2257-style record status).
-- Store only references to documents held in secure object storage; never the
-- document bytes. This exists from day one on purpose.
-- ---------------------------------------------------------------------------
CREATE TABLE creator_compliance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id          uuid NOT NULL REFERENCES creators(id)   ON DELETE CASCADE,
  status              compliance_status NOT NULL DEFAULT 'unverified',
  age_verified        boolean NOT NULL DEFAULT false,
  date_of_birth       date,          -- only with lawful basis; consider encryption
  id_document_ref     text,          -- object-storage key, NOT the file
  verification_method text,          -- e.g. 'third_party_kyc','manual_review'
  verified_by         uuid REFERENCES users(id),
  verified_at         timestamptz,
  expires_at          timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id)
);
CREATE INDEX idx_compliance_ws ON creator_compliance(workspace_id);
CREATE TRIGGER trg_compliance_updated BEFORE UPDATE ON creator_compliance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- creator_assignments — which chatter (membership) handles which creator
-- ---------------------------------------------------------------------------
CREATE TABLE creator_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id)  ON DELETE CASCADE,
  creator_id    uuid NOT NULL REFERENCES creators(id)    ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id, membership_id)
);
CREATE INDEX idx_assign_ws     ON creator_assignments(workspace_id);
CREATE INDEX idx_assign_member ON creator_assignments(membership_id);

-- ---------------------------------------------------------------------------
-- customers — fan CRM. PII: minimize, log access, support erasure.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id          uuid REFERENCES creators(id) ON DELETE SET NULL,
  alias               text NOT NULL,
  email               citext,
  phone               text,
  country             char(2),
  segment             customer_segment NOT NULL DEFAULT 'new',
  tags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_spend         numeric(14,2) NOT NULL DEFAULT 0,   -- cached; recomputed on transaction
  first_purchase_at   timestamptz,
  last_purchase_at    timestamptz,
  consent_marketing   boolean NOT NULL DEFAULT false,
  consent_recorded_at timestamptz,
  deleted_at          timestamptz,                        -- soft-delete for GDPR erasure/anonymization
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_ws      ON customers(workspace_id);
CREATE INDEX idx_customers_creator ON customers(creator_id);
CREATE INDEX idx_customers_segment ON customers(workspace_id, segment);
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- content_items — content vault (media stays in object storage; only refs here)
-- ---------------------------------------------------------------------------
CREATE TABLE content_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id       uuid NOT NULL REFERENCES creators(id)   ON DELETE CASCADE,
  type             content_type NOT NULL,
  category         text,
  price_suggestion numeric(12,2),
  currency         char(3),
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  storage_ref      text,                                  -- object-storage key
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_ws      ON content_items(workspace_id);
CREATE INDEX idx_content_creator ON content_items(creator_id);
CREATE TRIGGER trg_content_updated BEFORE UPDATE ON content_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- payment_links — PPV offers. The provider hosts the checkout; we store only
-- the link reference the provider returns. No card data ever touches this DB.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES workspaces(id)   ON DELETE CASCADE,
  creator_id       uuid NOT NULL REFERENCES creators(id)     ON DELETE RESTRICT,
  customer_id      uuid REFERENCES customers(id)             ON DELETE SET NULL,
  created_by       uuid REFERENCES memberships(id)           ON DELETE SET NULL,  -- attributed chatter
  content_id       uuid REFERENCES content_items(id)         ON DELETE SET NULL,
  description      text,
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  currency         char(3) NOT NULL,
  status           link_status NOT NULL DEFAULT 'created',
  provider_link_id text,                                  -- id/URL ref from provider hosted checkout
  reference_id     text,                                  -- our reference sent to the provider
  expires_at       timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_links_ws       ON payment_links(workspace_id);
CREATE INDEX idx_links_creator  ON payment_links(creator_id);
CREATE INDEX idx_links_customer ON payment_links(customer_id);
CREATE INDEX idx_links_status   ON payment_links(workspace_id, status);
CREATE UNIQUE INDEX idx_links_reference
  ON payment_links(workspace_id, reference_id) WHERE reference_id IS NOT NULL;
CREATE TRIGGER trg_links_updated BEFORE UPDATE ON payment_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- transactions — the money ledger, written from verified provider webhooks.
-- provider_transaction_id is unique per workspace for idempotency.
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payment_link_id          uuid REFERENCES payment_links(id) ON DELETE SET NULL,
  creator_id               uuid REFERENCES creators(id)      ON DELETE SET NULL,
  customer_id              uuid REFERENCES customers(id)     ON DELETE SET NULL,
  attributed_membership_id uuid REFERENCES memberships(id)   ON DELETE SET NULL,
  type                     txn_type   NOT NULL DEFAULT 'payment',
  status                   txn_status NOT NULL,
  gross                    numeric(14,2) NOT NULL DEFAULT 0,
  fee                      numeric(14,2) NOT NULL DEFAULT 0,
  net                      numeric(14,2) NOT NULL DEFAULT 0,
  currency                 char(3) NOT NULL,
  provider_transaction_id  text,
  occurred_at              timestamptz NOT NULL DEFAULT now(),
  raw_payload              jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider_transaction_id)
);
CREATE INDEX idx_txn_ws       ON transactions(workspace_id);
CREATE INDEX idx_txn_link     ON transactions(payment_link_id);
CREATE INDEX idx_txn_creator  ON transactions(creator_id);
CREATE INDEX idx_txn_occurred ON transactions(workspace_id, occurred_at);

-- ---------------------------------------------------------------------------
-- commission_rules — versioned splits (creator_id null = workspace default)
-- ---------------------------------------------------------------------------
CREATE TABLE commission_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  creator_id        uuid REFERENCES creators(id) ON DELETE CASCADE,
  creator_split_pct numeric(5,2) NOT NULL CHECK (creator_split_pct BETWEEN 0 AND 100),
  agency_split_pct  numeric(5,2) NOT NULL CHECK (agency_split_pct  BETWEEN 0 AND 100),
  chatter_pct       numeric(5,2) NOT NULL DEFAULT 0 CHECK (chatter_pct BETWEEN 0 AND 100),
  effective_from    timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_commrules_ws ON commission_rules(workspace_id, effective_from);

-- ---------------------------------------------------------------------------
-- payouts — computed payout records per payee per period
-- ---------------------------------------------------------------------------
CREATE TABLE payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  payee_type    text NOT NULL CHECK (payee_type IN ('creator','chatter','agency')),
  creator_id    uuid REFERENCES creators(id)    ON DELETE SET NULL,
  membership_id uuid REFERENCES memberships(id) ON DELETE SET NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  gross         numeric(14,2) NOT NULL DEFAULT 0,
  fees          numeric(14,2) NOT NULL DEFAULT 0,
  refunds       numeric(14,2) NOT NULL DEFAULT 0,
  net           numeric(14,2) NOT NULL DEFAULT 0,
  amount        numeric(14,2) NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL,
  status        payout_status NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payouts_ws ON payouts(workspace_id, period_start);
CREATE TRIGGER trg_payouts_updated BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- webhook_events — idempotent inbox for provider notifications
-- ---------------------------------------------------------------------------
CREATE TABLE webhook_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  provider          text NOT NULL,
  event_type        text,
  provider_event_id text,
  signature_valid   boolean,
  processed         boolean NOT NULL DEFAULT false,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_webhook_unprocessed ON webhook_events(processed) WHERE processed = false;

-- ---------------------------------------------------------------------------
-- audit_log — append-only record of actions and PII access
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id)      ON DELETE SET NULL,
  action        text NOT NULL,                 -- e.g. 'customer.export','link.create','login'
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_ws    ON audit_log(workspace_id, created_at);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id, created_at);

-- ---------------------------------------------------------------------------
-- refresh_tokens — server-side session/refresh handles (store only hashes)
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  ip         inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

COMMIT;
