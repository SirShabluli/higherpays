-- TOTP two-factor authentication (RFC 6238). Secret is base32; enabled flips
-- on only after the user confirms a valid code during setup.
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_secret  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS twofa_enabled boolean NOT NULL DEFAULT false;
