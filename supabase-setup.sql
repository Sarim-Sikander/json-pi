-- ============================================================
-- Json-Pi: Supabase setup
-- Run this SQL in your Supabase project's SQL editor.
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================================

CREATE TABLE IF NOT EXISTS contacts (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT,
  email      TEXT,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  user_agent TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for sorting by date (used by the Contact History view)
CREATE INDEX IF NOT EXISTS contacts_created_at_idx ON contacts(created_at DESC);

-- ============================================================
-- Row-Level Security (RLS)
-- We use Supabase's service_role key for all access from Netlify
-- Functions, which bypasses RLS. But it's good practice to enable
-- RLS so the anon/public key can never read or write contacts.
-- ============================================================

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Explicitly: no policies defined → no access for anon/public keys.
-- Only the service_role key (used server-side in Netlify) can read/write.

-- ============================================================
-- Done. You can verify with:
--   SELECT count(*) FROM contacts;
-- ============================================================
