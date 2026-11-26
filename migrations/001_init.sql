-- KB COD Manager — schéma initial.
-- Toutes les tables vivent dans le schéma "kbcod" (non exposé par l'API REST Supabase).
-- Isolation multi-boutiques : chaque table métier porte shop_id et chaque requête applicative filtre dessus.

CREATE SCHEMA IF NOT EXISTS kbcod;
SET search_path TO kbcod;

CREATE TABLE IF NOT EXISTS shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain text NOT NULL UNIQUE CHECK (shop_domain ~ '^[a-z0-9][a-z0-9-]*\.myshopify\.com$'),
  app_client_id text NOT NULL,
  access_token_enc text,
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text NOT NULL DEFAULT '',
  name text,
  email text,
  currency text NOT NULL DEFAULT 'XOF',
  money_format text NOT NULL DEFAULT '{{amount}}',
  primary_domain text,
  timezone text,
  app_installation_gid text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  installed_at timestamptz NOT NULL DEFAULT now(),
  uninstalled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS forms_one_default ON forms(shop_id) WHERE is_default AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS forms_shop ON forms(shop_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS form_versions (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version integer NOT NULL,
  config jsonb NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);

CREATE TABLE IF NOT EXISTS form_products (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id text NOT NULL CHECK (product_id ~ '^\d+$'),
  form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  product_title text,
  PRIMARY KEY (shop_id, product_id)
);

CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('quantity','upsell','downsell','post_purchase')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offers_shop ON offers(shop_id, type);

-- Soumissions : clé d'idempotence = id (généré par le navigateur), unique par boutique.
CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  form_id uuid REFERENCES forms(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('processing','created','failed','blocked','otp_pending','uncertain')),
  phone_e164 text,
  phone_hash text,
  ip_hash text,
  device_hash text,
  email_hash text,
  customer jsonb NOT NULL DEFAULT '{}'::jsonb,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  quote jsonb,
  currency text,
  total_minor bigint,
  shopify_order_gid text,
  shopify_order_name text,
  order_status_url text,
  client jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  verified_phone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_shop_created ON submissions(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_phone ON submissions(shop_id, phone_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_ip ON submissions(shop_id, ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_device ON submissions(shop_id, device_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_email ON submissions(shop_id, email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_order ON submissions(shop_id, shopify_order_gid);

-- Tentatives (y compris bloquées) pour les limites anti-répétition.
CREATE TABLE IF NOT EXISTS attempts (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  ip_hash text,
  phone_hash text,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempts_ip ON attempts(shop_id, ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS list_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  list text NOT NULL CHECK (list IN ('block','allow')),
  kind text NOT NULL CHECK (kind IN ('phone','ip','email','device','phone_prefix','ip_prefix')),
  value_hash text,
  value_pattern text,
  display text NOT NULL,
  reason text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS list_entries_lookup ON list_entries(shop_id, kind, value_hash);

CREATE TABLE IF NOT EXISTS fraud_events (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  submission_id uuid,
  rule text NOT NULL,
  action text NOT NULL,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fraud_events_shop ON fraud_events(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  phone_hash text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sends integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_phone ON otp_challenges(shop_id, phone_hash, created_at DESC);

-- File de travaux durable (Sheets, Meta, notifications, réconciliation…).
CREATE TABLE IF NOT EXISTS jobs (
  id bigserial PRIMARY KEY,
  shop_id uuid REFERENCES shops(id) ON DELETE CASCADE,
  type text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed','dead','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(run_at) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS jobs_shop ON jobs(shop_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS google_connections (
  shop_id uuid PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  google_email text,
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  scope text,
  status text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','revoked','error')),
  spreadsheet_id text,
  spreadsheet_title text,
  sheet_title text,
  sheet_id bigint,
  mapping jsonb NOT NULL DEFAULT '[]'::jsonb,
  row_mode text NOT NULL DEFAULT 'order' CHECK (row_mode IN ('order','product')),
  enabled boolean NOT NULL DEFAULT false,
  include_blocked boolean NOT NULL DEFAULT false,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sheet_syncs (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL,
  spreadsheet_id text NOT NULL,
  sheet_title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','synced','retrying','action_required')),
  attempts integer NOT NULL DEFAULT 0,
  updated_range text,
  last_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, submission_id, spreadsheet_id, sheet_title)
);

CREATE TABLE IF NOT EXISTS pixels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('meta','tiktok','snapchat','pinterest','google_ads','ga4')),
  name text NOT NULL,
  pixel_id text NOT NULL,
  capi_token_enc text,
  test_event_code text,
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, provider, pixel_id)
);

CREATE TABLE IF NOT EXISTS tracking_events (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  pixel_row_id uuid NOT NULL REFERENCES pixels(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  event_id text NOT NULL,
  stage text NOT NULL,
  submission_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','retrying','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  payload jsonb,
  response jsonb,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pixel_row_id, event_name, event_id)
);
CREATE INDEX IF NOT EXISTS tracking_events_shop ON tracking_events(shop_id, created_at DESC);

CREATE TABLE IF NOT EXISTS abandoned (
  id uuid PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  form_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','abandoned','converted','recovered','dismissed')),
  phone_e164 text,
  email text,
  name text,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  product_id text,
  variant_id text,
  quantity integer,
  consent boolean NOT NULL DEFAULT false,
  notified_at timestamptz,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abandoned_shop ON abandoned(shop_id, status, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS message_logs (
  id bigserial PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  channel text NOT NULL,
  template text NOT NULL,
  to_masked text NOT NULL,
  status text NOT NULL,
  provider_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stats_daily (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  day date NOT NULL,
  form_id uuid,
  metric text NOT NULL,
  count bigint NOT NULL DEFAULT 0,
  amount_minor bigint NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS stats_daily_key ON stats_daily(shop_id, day, coalesce(form_id, '00000000-0000-0000-0000-000000000000'::uuid), metric);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  shop_id uuid REFERENCES shops(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_receipts (
  webhook_id text PRIMARY KEY,
  shop_domain text NOT NULL,
  topic text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Défense en profondeur : RLS activée sans politique → aucun accès via anon/authenticated.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'kbcod' LOOP
    EXECUTE format('ALTER TABLE kbcod.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
