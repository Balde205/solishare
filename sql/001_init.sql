CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('particulier','commercant','association');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE offer_category AS ENUM ('alimentaire','materiel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE offer_type AS ENUM ('don','vente_flash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE offer_status AS ENUM ('disponible','reserve','retire','expire');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE reservation_status AS ENUM ('active','validee','annulee','expiree');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'particulier',
  position_geo GEOGRAPHY(Point,4326),
  rayon_alerte_m INTEGER NOT NULL DEFAULT 1000 CHECK (rayon_alerte_m BETWEEN 100 AND 50000),
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_position_gix ON users USING GIST(position_geo);

CREATE TABLE IF NOT EXISTS offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id),
  title VARCHAR(120) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category offer_category NOT NULL,
  offer_type offer_type NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  quantity_label VARCHAR(80) NOT NULL DEFAULT '',
  photo_url TEXT,
  position_geo GEOGRAPHY(Point,4326) NOT NULL,
  address_label VARCHAR(300) NOT NULL,
  status offer_status NOT NULL DEFAULT 'disponible',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (offer_type <> 'don' OR price_cents = 0)
);
CREATE INDEX IF NOT EXISTS offers_position_gix ON offers USING GIST(position_geo);
CREATE INDEX IF NOT EXISTS offers_status_expiry_idx ON offers(status,expires_at);

CREATE TABLE IF NOT EXISTS user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fcm_token TEXT NOT NULL UNIQUE,
  platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios','android')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  distance_m INTEGER,
  fcm_message_id TEXT,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (offer_id,user_id)
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offers(id),
  receiver_id UUID NOT NULL REFERENCES users(id),
  qr_token TEXT UNIQUE,
  status reservation_status NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ NOT NULL,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_reservation_per_offer
  ON reservations(offer_id) WHERE status='active';

CREATE TABLE IF NOT EXISTS impact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  points INTEGER NOT NULL,
  reason VARCHAR(80) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (reservation_id,user_id,reason)
);
