-- Count invitation-link visits per code. Raw visits, including QR scans and repeats.
ALTER TABLE referral_codes ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0);
