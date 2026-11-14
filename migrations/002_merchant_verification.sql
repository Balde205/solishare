ALTER TABLE users
  ADD COLUMN IF NOT EXISTS siret VARCHAR(14),
  ADD COLUMN IF NOT EXISTS business_address TEXT,
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS verification_note TEXT;

-- Les particuliers sont vérifiés par défaut pour pouvoir donner et réserver immédiatement
UPDATE users SET is_verified = TRUE WHERE role = 'particulier';

CREATE INDEX IF NOT EXISTS idx_users_role_verified ON users (role, is_verified);